[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('core', 'web', 'android', 'desktop')]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$Environment
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Join-Path $workspaceRoot "tastile-$Repository"
$configurationPath = Join-Path $workspaceRoot '.infisical.json'
$temporaryDirectory = Join-Path $workspaceRoot '.tmp'
$examplePath = Join-Path $repositoryRoot '.env.example'
$secretPath = "/tastile/$Repository"

if (-not (Test-Path -LiteralPath $repositoryRoot -PathType Container)) {
    throw "Repository directory is missing: tastile-$Repository"
}
if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    throw 'Workspace .infisical.json is missing; refusing to use an implicit Infisical project.'
}

$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
$domain = [string]$configuration.domain
$projectId = [string]$configuration.workspaceId
if ($domain -notmatch '^https://[^/]+/?$' -or [string]::IsNullOrWhiteSpace($projectId)) {
    throw 'Workspace .infisical.json must specify an HTTPS domain and project ID.'
}
if (-not (Get-Command infisical -ErrorAction SilentlyContinue) -or -not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Infisical CLI and Git CLI are required.'
}

function Test-GitIgnoredPath {
    param(
        [Parameter(Mandatory = $true)][string]$GitRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    & git -C $GitRoot check-ignore --quiet -- $RelativePath *> $null
    return ($LASTEXITCODE -eq 0)
}

function Set-PrivateFilePermissions {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($IsWindows) {
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $Path /inheritance:r /grant:r "$currentUser`:(F)" /q *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not restrict temporary Infisical exports to the current Windows user.'
        }
        $rules = @(Get-Acl -LiteralPath $Path | Select-Object -ExpandProperty Access)
        if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $currentUser -or
            $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Temporary Infisical export permissions do not match the current-user-only policy.'
        }
    } else {
        $privateMode = [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
        [System.IO.File]::SetUnixFileMode($Path, $privateMode)
        if ([System.IO.File]::GetUnixFileMode($Path) -ne $privateMode) {
            throw 'Temporary Infisical export permissions do not match mode 0600.'
        }
    }
}

if (Test-GitIgnoredPath -GitRoot $repositoryRoot -RelativePath '.env.example') {
    throw '.env.example is ignored by Git; add an explicit exception before generating the schema.'
}

$null = New-Item -ItemType Directory -Path $temporaryDirectory -Force
$temporaryDirectoryRelativePath = '.tmp'
if (-not (Test-GitIgnoredPath -GitRoot $workspaceRoot -RelativePath $temporaryDirectoryRelativePath)) {
    throw 'Temporary export directory is not ignored by Git: .tmp'
}

$runId = [guid]::NewGuid().ToString('N')
$keyNames = [System.Collections.Generic.SortedSet[string]]::new([System.StringComparer]::Ordinal)
$temporaryFiles = [System.Collections.Generic.List[string]]::new()
$temporaryJsonPath = Join-Path $temporaryDirectory "infisical-example-$runId.json"
$temporaryExamplePath = Join-Path $temporaryDirectory "infisical-example-$runId.tmp"
$temporaryFiles.Add($temporaryJsonPath)
$temporaryFiles.Add($temporaryExamplePath)

foreach ($temporaryPath in $temporaryFiles) {
    $relativeTemporaryPath = ".tmp/$(Split-Path -Leaf $temporaryPath)"
    if (-not (Test-GitIgnoredPath -GitRoot $workspaceRoot -RelativePath $relativeTemporaryPath)) {
        throw "Temporary Infisical file is not ignored by Git: $relativeTemporaryPath"
    }
}

try {
    $null = New-Item -ItemType File -Path $temporaryJsonPath
    Set-PrivateFilePermissions -Path $temporaryJsonPath
    & infisical --domain=$domain --silent export `
        --projectId=$projectId `
        --env=$Environment `
        --path=$secretPath `
        --format=json `
        --secret-overriding=false `
        --output-file=$temporaryJsonPath *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryJsonPath -PathType Leaf)) {
        throw "Infisical export failed for $Repository / $Environment (exit code $LASTEXITCODE). No example was changed."
    }

    $records = @(Get-Content -LiteralPath $temporaryJsonPath -Raw | ConvertFrom-Json -AsHashtable)
    $environmentKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($record in $records) {
        if ($null -eq $record -or [string]::IsNullOrWhiteSpace([string]$record.key) -or $null -eq $record.value) {
            throw "Infisical returned an invalid secret record for $Repository / $Environment. No example was changed."
        }
        $key = [string]$record.key
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Infisical returned an invalid environment key for $Repository / $Environment. No example was changed."
        }
        if (-not $environmentKeys.Add($key)) {
            throw "Infisical returned a duplicate environment key for $Repository / $Environment. No example was changed."
        }
        $null = $keyNames.Add($key)
    }

    if ($keyNames.Count -eq 0) {
        throw "Infisical returned no keys for $Repository / $Environment; refusing to create an empty example."
    }

    $null = New-Item -ItemType File -Path $temporaryExamplePath
    $exampleLines = @($keyNames | ForEach-Object { "$_=" })
    [System.IO.File]::WriteAllLines($temporaryExamplePath, $exampleLines, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryExamplePath -Destination $examplePath -Force

    Write-Output "Generated tastile-$Repository/.env.example from Infisical key names ($Environment; $($keyNames.Count) keys). Values are blank."
} finally {
    foreach ($temporaryPath in $temporaryFiles) {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}
