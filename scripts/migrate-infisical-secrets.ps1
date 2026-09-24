[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$SourceProjectId,

    [Parameter(Mandatory = $true)]
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$SourceEnvironment,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^/(?:[^/]+/?)*$')]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$TargetEnvironment,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^/(?:[^/]+/?)*$')]
    [string]$TargetPath
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$configurationPath = Join-Path $workspaceRoot '.infisical.json'
$temporaryRoot = Join-Path $workspaceRoot '.tmp'

if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    throw 'Workspace .infisical.json is missing; refusing to use an implicit target project.'
}

$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
$domain = [string]$configuration.domain
$projectConfigurationPath = Join-Path $PSScriptRoot 'get-infisical-project.ps1'
. $projectConfigurationPath
$targetProject = Get-InfisicalProjectConfiguration -Configuration $configuration -Environment $TargetEnvironment
$domain = $targetProject.domain
$targetProjectId = $targetProject.projectId
if ($domain -notmatch '^https://[^/]+/?$' -or [string]::IsNullOrWhiteSpace($targetProjectId)) {
    throw "Workspace .infisical.json must specify an HTTPS domain and a $TargetEnvironment target project ID."
}
if ($SourceProjectId -eq $targetProjectId -and $SourcePath -eq $TargetPath -and $SourceEnvironment -eq $TargetEnvironment) {
    throw 'Refusing to migrate a secret set onto itself.'
}
if (-not (Get-Command infisical -ErrorAction SilentlyContinue) -or -not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Infisical CLI and Git CLI are required.'
}

$sourceCliWorkspacePath = $null
$targetCliWorkspacePath = $null

function Set-PrivateFilePermissions {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($IsWindows) {
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $Path /inheritance:r /grant:r "$currentUser`:(F)" /q *> $null
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not restrict migration files to the current Windows user.'
        }
        $rules = @(Get-Acl -LiteralPath $Path | Select-Object -ExpandProperty Access)
        if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $currentUser -or
            $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Migration file permissions do not match the current-user-only policy.'
        }
    } else {
        $privateMode = [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
        [System.IO.File]::SetUnixFileMode($Path, $privateMode)
        if ([System.IO.File]::GetUnixFileMode($Path) -ne $privateMode) {
            throw 'Migration file permissions do not match mode 0600.'
        }
    }
}

function Test-GitIgnoredPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    & git -C $workspaceRoot check-ignore --quiet -- $RelativePath *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-SecretMap {
    param([Parameter(Mandatory = $true)][string]$Path)

    $records = @(Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable)
    $secrets = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::Ordinal)
    foreach ($record in $records) {
        if ($null -eq $record -or [string]::IsNullOrWhiteSpace([string]$record.key) -or $null -eq $record.value) {
            throw 'Secret JSON export contains a record without a key or value.'
        }
        $key = [string]$record.key
        if ($secrets.ContainsKey($key)) {
            throw 'Secret JSON export contains a duplicate key.'
        }
        $secrets.Add($key, [string]$record.value)
    }
    return ,$secrets
}

$null = New-Item -ItemType Directory -Path $temporaryRoot -Force
$temporaryDirectoryName = "infisical-migration-$([guid]::NewGuid().ToString('N'))"
$temporaryDirectory = Join-Path $temporaryRoot $temporaryDirectoryName
$relativeDirectory = ".tmp/$temporaryDirectoryName"
if (-not (Test-GitIgnoredPath -RelativePath $relativeDirectory)) {
    throw "Temporary migration directory is not ignored by Git: $relativeDirectory"
}
$null = New-Item -ItemType Directory -Path $temporaryDirectory
$temporaryPaths = @(
    (Join-Path $temporaryDirectory 'source.json'),
    (Join-Path $temporaryDirectory 'target-before.json'),
    (Join-Path $temporaryDirectory 'target-after.json')
)
foreach ($temporaryPath in $temporaryPaths) {
    $relativePath = ".tmp/$temporaryDirectoryName/$([System.IO.Path]::GetFileName($temporaryPath))"
    if (-not (Test-GitIgnoredPath -RelativePath $relativePath)) {
        throw "Temporary migration file is not ignored by Git: $relativePath"
    }
}
$sourceJsonPath = $temporaryPaths[0]
$targetBeforeTemporaryPath = $temporaryPaths[1]
$targetAfterTemporaryPath = $temporaryPaths[2]

try {
    $sourceCliWorkspacePath = New-InfisicalCliWorkspace -ProjectId $SourceProjectId -Domain $domain -WorkspaceRoot $workspaceRoot
    $targetCliWorkspacePath = New-InfisicalCliWorkspace -ProjectId $targetProjectId -Domain $domain -WorkspaceRoot $workspaceRoot
    foreach ($temporaryPath in $temporaryPaths) {
        $null = New-Item -ItemType File -Path $temporaryPath
        Set-PrivateFilePermissions -Path $temporaryPath
    }

    $sourceExportExitCode = Invoke-InfisicalCli -WorkspacePath $sourceCliWorkspacePath -Domain $domain -Arguments @(
        'export', "--env=$SourceEnvironment", "--path=$SourcePath", '--format=json',
        '--secret-overriding=false', "--output-file=$sourceJsonPath"
    )
    if ($sourceExportExitCode -ne 0) {
        throw "Source verification export failed (exit code $sourceExportExitCode); no target changes were made."
    }
    $sourceSecrets = Get-SecretMap -Path $sourceJsonPath
    if ($sourceSecrets.Count -eq 0) {
        throw 'Source export contained no secrets; no target changes were made.'
    }

    $targetBeforeExitCode = Invoke-InfisicalCli -WorkspacePath $targetCliWorkspacePath -Domain $domain -Arguments @(
        'export', "--env=$TargetEnvironment", "--path=$TargetPath", '--format=json',
        '--secret-overriding=false', "--output-file=$targetBeforeTemporaryPath"
    )
    if ($targetBeforeExitCode -ne 0) {
        throw "Target preflight failed (exit code $targetBeforeExitCode); no target changes were made."
    }
    if ((Get-SecretMap -Path $targetBeforeTemporaryPath).Count -ne 0) {
        throw 'Target path is not empty; refusing to overwrite or merge secrets.'
    }

    foreach ($key in $sourceSecrets.Keys) {
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw 'Source contains a key that cannot be safely passed to the Infisical CLI.'
        }
        $valuePath = Join-Path $temporaryDirectory "$key.value"
        $relativePath = ".tmp/$temporaryDirectoryName/$key.value"
        if (-not (Test-GitIgnoredPath -RelativePath $relativePath)) {
            throw "Temporary secret file is not ignored by Git: $relativePath"
        }
        $null = New-Item -ItemType File -Path $valuePath
        Set-PrivateFilePermissions -Path $valuePath
        Set-Content -LiteralPath $valuePath -Value $sourceSecrets[$key] -NoNewline -Encoding utf8NoBOM
    }

    foreach ($key in $sourceSecrets.Keys) {
        $valuePath = Join-Path $temporaryDirectory "$key.value"
        $setExitCode = Invoke-InfisicalCli -WorkspacePath $targetCliWorkspacePath -Domain $domain -Arguments @(
            'secrets', 'set', "$key=@$valuePath", "--env=$TargetEnvironment", "--path=$TargetPath"
        )
        if ($setExitCode -ne 0) {
            throw "Target import failed for key $key (exit code $setExitCode); source values were retained. Check the target for partial creation before retrying."
        }
    }

    $targetAfterExitCode = Invoke-InfisicalCli -WorkspacePath $targetCliWorkspacePath -Domain $domain -Arguments @(
        'export', "--env=$TargetEnvironment", "--path=$TargetPath", '--format=json',
        '--secret-overriding=false', "--output-file=$targetAfterTemporaryPath"
    )
    if ($targetAfterExitCode -ne 0) {
        throw "Target verification export failed (exit code $targetAfterExitCode); source values were retained."
    }
    $targetSecrets = Get-SecretMap -Path $targetAfterTemporaryPath
    if ($targetSecrets.Count -ne $sourceSecrets.Count) {
        throw 'Source and target secret key counts did not match; source values were retained.'
    }
    foreach ($key in $sourceSecrets.Keys) {
        if (-not $targetSecrets.ContainsKey($key) -or $targetSecrets[$key] -cne $sourceSecrets[$key]) {
            throw "Source and target secret values did not match for key $key; source values were retained."
        }
    }

    Write-Output "Migrated and verified $($sourceSecrets.Count) keys from project $SourceProjectId ($SourceEnvironment $SourcePath) to the configured project ($TargetEnvironment $TargetPath). Values were not printed; source secrets were retained."
} finally {
    foreach ($temporaryPath in $temporaryPaths) {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
    if (Test-Path -LiteralPath $temporaryDirectory -PathType Container) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
    if ($sourceCliWorkspacePath) {
        Remove-InfisicalCliWorkspace -Path $sourceCliWorkspacePath -WorkspaceRoot $workspaceRoot
    }
    if ($targetCliWorkspacePath) {
        Remove-InfisicalCliWorkspace -Path $targetCliWorkspacePath -WorkspaceRoot $workspaceRoot
    }
}
