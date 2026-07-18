[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$Id,
    [Parameter(Mandatory)][string]$Agent,
    [Parameter(Mandatory)][string[]]$FileGlob,
    [ValidateRange(1, 86400)][int]$TtlSeconds = 3600,
    [switch]$Renew,
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
if ($Id -eq 'live-stack') { throw "'live-stack' is reserved for release-claim.ps1." }
if ($Renew -and $Release) { throw 'Specify only one of -Renew or -Release.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$claimsDirectory = Join-Path $root 'docs\implementation\recurring-to-source\.claims'

function Normalize-Glob([string]$Value) { return $Value.Replace('\', '/').Trim().TrimStart('.').TrimStart('/').TrimEnd('/') }
function Test-GlobOverlap([string]$Left, [string]$Right) {
    $leftValue = Normalize-Glob $Left; $rightValue = Normalize-Glob $Right
    if (-not $leftValue -or -not $rightValue -or $leftValue -eq '**' -or $rightValue -eq '**') { return $true }
    if ($leftValue -eq $rightValue) { return $true }
    $leftPrefix = ($leftValue -split '[*?\[]', 2)[0].TrimEnd('/')
    $rightPrefix = ($rightValue -split '[*?\[]', 2)[0].TrimEnd('/')
    if ($leftPrefix -and ($rightValue.StartsWith($leftPrefix + '/') -or $rightPrefix.StartsWith($leftPrefix + '/'))) { return $true }
    if ($rightPrefix -and ($leftValue.StartsWith($rightPrefix + '/') -or $leftPrefix.StartsWith($rightPrefix + '/'))) { return $true }
    if ($leftValue -match '[*?\[]' -or $rightValue -match '[*?\[]') {
        $leftAtRoot = -not $leftValue.Contains('/')
        $rightAtRoot = -not $rightValue.Contains('/')
        if ($leftAtRoot -and $rightAtRoot -and (-not $leftPrefix -or -not $rightPrefix -or $leftPrefix.StartsWith($rightPrefix) -or $rightPrefix.StartsWith($leftPrefix))) { return $true }
    }
    $leftParent = if ($leftPrefix) { Split-Path $leftPrefix -Parent } else { $null }
    $rightParent = if ($rightPrefix) { Split-Path $rightPrefix -Parent } else { $null }
    return (($leftValue -match '[*?\[]' -or $rightValue -match '[*?\[]') -and $leftParent -and $leftParent -eq $rightParent)
}

$mutex = [System.Threading.Mutex]::new($false, 'Global\tastile-recurring-to-source-claims')
$hasMutex = $false
try {
    try { $hasMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(30)) }
    catch [System.Threading.AbandonedMutexException] { $hasMutex = $true }
    if (-not $hasMutex) { throw 'Timed out waiting for the claim registry.' }
    [System.IO.Directory]::CreateDirectory($claimsDirectory) | Out-Null
    foreach ($glob in $FileGlob) { if ((Normalize-Glob $glob) -eq 'live-stack') { throw "'live-stack' is reserved for release-claim.ps1." } }
    $now = [DateTime]::UtcNow; $target = Join-Path $claimsDirectory ($Id + '.json')
    if ($Release) {
        if (-not (Test-Path -LiteralPath $target)) { throw "Claim '$Id' does not exist." }
        $prior = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
        if ($prior.releaseState -ne 'active' -or [DateTime]$prior.expiresUtc -le $now) { throw "Claim '$Id' is not active." }
        if ($prior.agent -ne $Agent -or (@($prior.fileGlob) -join "`n") -ne (@($FileGlob) -join "`n")) { throw 'Release requires the same agent and file globs.' }
        $record = [ordered]@{ id=$prior.id; agent=$prior.agent; fileGlob=@($prior.fileGlob); acquiredUtc=$prior.acquiredUtc; expiresUtc=$prior.expiresUtc; releaseState='released'; releasedUtc=$now.ToString('o') }
        $temporary = Join-Path $claimsDirectory ('.' + $Id + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
        [System.IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json -Depth 3), [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::Move($temporary, $target, $true)
        $record | ConvertTo-Json -Depth 3
        return
    }
    $existing = Get-ChildItem -LiteralPath $claimsDirectory -Filter '*.json' -File | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json }
    foreach ($claim in $existing) {
        if ($claim.releaseState -ne 'active' -or [DateTime]$claim.expiresUtc -le $now) { continue }
        if ($claim.id -eq $Id) {
            if (-not $Renew) { throw "Active claim '$Id' cannot be overwritten; use -Renew with the same owner and globs." }
            if ($claim.agent -ne $Agent -or (@($claim.fileGlob) -join "`n") -ne (@($FileGlob) -join "`n")) { throw 'Renew requires the same agent and file globs.' }
            continue
        }
        foreach ($requestedGlob in $FileGlob) { foreach ($claimedGlob in @($claim.fileGlob)) {
            if (Test-GlobOverlap $requestedGlob $claimedGlob) { throw "Active claim '$($claim.id)' by '$($claim.agent)' overlaps '$requestedGlob'." }
        }}
    }
    $record = [ordered]@{ id=$Id; agent=$Agent; fileGlob=@($FileGlob); acquiredUtc=$now.ToString('o'); expiresUtc=$now.AddSeconds($TtlSeconds).ToString('o'); releaseState='active' }
    $temporary = Join-Path $claimsDirectory ('.' + $Id + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json -Depth 3), [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move($temporary, $target, $true); $record | ConvertTo-Json -Depth 3
}
finally { if ($hasMutex) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
