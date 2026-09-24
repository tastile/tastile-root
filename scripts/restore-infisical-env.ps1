[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('core', 'web', 'android', 'desktop')]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [ValidateSet('development', 'staging', 'production')]
    [string]$Environment,

    [switch]$Force,
    [switch]$RemoveAfterRestore,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Join-Path $workspaceRoot "tastile-$Repository"
$configurationPath = Join-Path $workspaceRoot '.infisical.json'
$environmentSlug = @{
    development = 'dev'
    staging = 'staging'
    production = 'prod'
}[$Environment]
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

$outputName = if ($Repository -eq 'web') {
    @{
        development = '.env.development'
        staging = '.env.staging'
        production = '.env.production'
    }[$Environment]
} else {
    '.env'
}
$outputPath = Join-Path $repositoryRoot $outputName
$temporaryDirectory = Join-Path $repositoryRoot '.tmp'

if (-not (Get-Command infisical -ErrorAction SilentlyContinue)) {
    throw 'Infisical CLI was not found. Install the CLI and authenticate to the configured self-hosted instance.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git CLI is required to verify that generated secret files are ignored.'
}

if ((Test-Path -LiteralPath $outputPath -PathType Leaf) -and -not $Force) {
    throw "Output already exists: $outputPath. Use -Force to replace this generated file."
}

if ($ValidateOnly) {
    Write-Output "Configuration is valid for $Repository / $Environment ($environmentSlug) at $secretPath. No secrets were fetched."
    return
}

function Set-PrivateFilePermissions {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($IsWindows) {
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $Path /inheritance:r /grant:r "$currentUser`:(F)" /q *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not restrict the generated environment file to the current Windows user.'
        }

        $verifiedRules = @(Get-Acl -LiteralPath $Path | Select-Object -ExpandProperty Access)
        if ($verifiedRules.Count -ne 1 -or $verifiedRules[0].IdentityReference.Value -ne $currentUser -or
            $verifiedRules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            $verifiedRules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Could not restrict the generated environment file to the current Windows user.'
        }
    } else {
        $privateMode = [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
        [System.IO.File]::SetUnixFileMode($Path, $privateMode)
        if ([System.IO.File]::GetUnixFileMode($Path) -ne $privateMode) {
            throw 'Could not restrict the generated environment file to mode 0600.'
        }
    }
}

function Test-GitIgnoredPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    & git -C $repositoryRoot check-ignore --quiet -- $RelativePath *> $null
    return ($LASTEXITCODE -eq 0)
}

$null = New-Item -ItemType Directory -Path $temporaryDirectory -Force
$relativeOutputPath = $outputName
$temporaryName = "infisical-export-$([guid]::NewGuid().ToString('N')).env"
$relativeTemporaryPath = ".tmp/$temporaryName"
$temporaryPath = Join-Path $temporaryDirectory $temporaryName
$outputInstalled = $false
if (-not (Test-GitIgnoredPath -RelativePath $relativeOutputPath)) {
    throw "Generated output is not ignored by Git: $relativeOutputPath"
}
if (-not (Test-GitIgnoredPath -RelativePath $relativeTemporaryPath)) {
    throw "Temporary secret output is not ignored by Git: $relativeTemporaryPath"
}

try {
    $null = New-Item -ItemType File -Path $temporaryPath
    Set-PrivateFilePermissions -Path $temporaryPath
    & infisical --domain=$domain --silent export `
        --projectId=$projectId `
        --env=$environmentSlug `
        --path=$secretPath `
        --format=dotenv `
        --secret-overriding=false `
        --output-file=$temporaryPath *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
        throw "Infisical export failed (exit code $LASTEXITCODE). Confirm CLI login and access to the selected path."
    }

    $dotenv = Get-Content -LiteralPath $temporaryPath -Raw
    $keyCount = [regex]::Matches($dotenv, '(?m)^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=').Count
    if ($keyCount -lt 1) {
        throw "Infisical returned no dotenv keys for $Environment at $secretPath; refusing to create an empty environment file."
    }

    [System.IO.File]::Move($temporaryPath, $outputPath, $true)
    $outputInstalled = $true
    Set-PrivateFilePermissions -Path $outputPath
    if ($RemoveAfterRestore) {
        Remove-Item -LiteralPath $outputPath -Force
        Write-Output "Restore verified for $Repository / $Environment ($keyCount keys); the generated file was removed. Secret values were not printed."
    } else {
        Write-Output "Restored $Repository / $Environment ($keyCount keys) to $outputPath. Secret values were not printed."
    }
} catch {
    if ($outputInstalled -and (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
        try {
            Remove-Item -LiteralPath $outputPath -Force
        } catch {
            throw "Restore failed and its generated output could not be removed. Delete '$outputPath' manually before retrying."
        }
    }
    throw $_
} finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}
