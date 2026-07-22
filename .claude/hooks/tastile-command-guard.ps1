Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Deny([string] $reason) {
    [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = $reason
        }
    } | ConvertTo-Json -Compress
    exit 0
}

function Get-CommandSegments([string] $text) {
    return @([regex]::Split($text, '(?<![>|&])[;&|](?![|&])') | ForEach-Object Trim | Where-Object { $_ })
}

function Test-Java17([string] $javaHome) {
    if ([string]::IsNullOrWhiteSpace($javaHome)) { return $false }
    try {
        $resolvedHome = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($javaHome.Trim())
        $java = @('java.exe', 'java.cmd', 'java') |
            ForEach-Object { Join-Path $resolvedHome "bin/$_" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
        if (-not $java) { return $false }
        $versionOutput = & $java -version 2>&1 | Out-String
        return $LASTEXITCODE -eq 0 -and $versionOutput -match '(?im)^\s*(?:openjdk|java) version "17(?:[._]|\")'
    } catch { return $false }
}

$inputText = [Console]::In.ReadToEnd()
try { $payload = $inputText | ConvertFrom-Json } catch { exit 0 }
$command = [string]$payload.tool_input.command
if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }
$cwd = [string]$payload.cwd
if ([string]::IsNullOrWhiteSpace($cwd)) { $cwd = (Get-Location).Path }

if ($command -match '(?i)(^|[;&|\s])(npm\s+(install|i|run)\b|npx\b|yarn\s+(install|add|run)\b|^yarn\b|pnpm\s+(install|add|run)\b|^pnpm\b)') {
    Deny 'Use bun install, bun add, bun run, or bunx instead of npm/npx/yarn/pnpm.'
}

$segments = Get-CommandSegments $command
$isCore = ($cwd -match '(?i)(^|[\\/])tastile-core([\\/]|$)') -or ($command -match '(?i)(^|[\\/\s])tastile-core([\\/\s]|$)')
$cargoPattern = '(?i)(^|\s)cargo(?:\s+\+\S+)?(?:\s+(?!--?build\b|--?test\b|--?check\b|--?run\b|--?bench\b)--?\S+(?:\s+(?!\+?build\b|\+?test\b|\+?check\b|\+?run\b|\+?bench\b|--\S+)\S+)*)*\s+(build|test|check|run|bench)\b'
$unsafeCargo = $false
foreach ($segment in $segments) {
    if ($segment -notmatch $cargoPattern) { continue }
    $wslCargo = $segment -match '(?i)^\s*wslc\s+container\b'
    if (-not $wslCargo) { $unsafeCargo = $true; break }
}
if ($isCore -and $unsafeCargo) {
    Deny 'Run tastile-core cargo build/test/check/run/bench through wslc container only.'
}

$androidPathPattern = '(?i)(^|[\\/])tastile-android([\\/]|$)'
$gradlePattern = '(?i)(^|[;&|\s])(?:\.?[\\/])*(?:tastile-android[\\/])?gradlew(?:\.bat)?\b'
$isAndroidGradle = (($cwd -match $androidPathPattern) -or ($command -match $androidPathPattern)) -and ($command -match $gradlePattern)
if ($isAndroidGradle) {
    $propsPath = $env:TASTILE_GUARD_GRADLE_PROPERTIES
    if ([string]::IsNullOrWhiteSpace($propsPath)) {
        $androidRoot = if ($cwd -match $androidPathPattern) { $cwd } else { Join-Path $cwd 'tastile-android' }
        $candidate = Join-Path $androidRoot 'gradle.properties'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $propsPath = $candidate }
    }

    $pinned17 = $false
    if ($propsPath -and (Test-Path -LiteralPath $propsPath -PathType Leaf)) {
        $match = [regex]::Match((Get-Content -LiteralPath $propsPath -Raw), '(?im)^\s*org\.gradle\.java\.home\s*=\s*(.+?)\s*$')
        if ($match.Success) { $pinned17 = Test-Java17 $match.Groups[1].Value }
    }
    if (-not $pinned17 -and -not (Test-Java17 ([string]$env:JAVA_HOME))) {
        Deny 'Android Gradle commands require Java 17 or a gradle.properties org.gradle.java.home JDK17 pin.'
    }
}

$isRoot = -not ($cwd -match '(?i)(^|[\\/])tastile-(core|web|android|desktop|brands)([\\/]|$)')
$isGit = $command -match '(?i)(^|[;&|\s])git(?:\.exe)?\b'
$readOnlyGitSegments = [regex]::Matches($command, '(?i)(?:^|[;&|])\s*git(?:\.exe)?\s+(?:-C\s+[^\s;|]+\s+)*(status|diff|log|show|branch\s+--show-current)\b')
$gitSegments = [regex]::Matches($command, '(?i)(?:^|[;&|])\s*git(?:\.exe)?\b')
$allGitReadOnly = $gitSegments.Count -gt 0 -and $readOnlyGitSegments.Count -eq $gitSegments.Count
$childRefs = @([regex]::Matches($command, '(?i)tastile-(?:core|web|android|desktop|brands)') | ForEach-Object Value | Sort-Object -Unique)
if ($isRoot -and $isGit -and -not $allGitReadOnly -and $childRefs.Count -ge 2) {
    Deny 'Do not mutate multiple independent tastile-* child repositories from the workspace root.'
}
if ($isRoot -and $command -match '(?i)\bgit(?:\.exe)?\s+(?:add|commit)\b' -and $command -match '(?i)tastile-(?:core|web|android|desktop|brands)') {
    Deny 'Run git add/commit inside the specific child repository, not from the workspace root.'
}

exit 0
