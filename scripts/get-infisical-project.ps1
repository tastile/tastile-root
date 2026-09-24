function Get-InfisicalProjectConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Configuration,

        [Parameter(Mandatory = $true)]
        [ValidateSet('dev', 'staging', 'prod')]
        [string]$Environment
    )

    $domain = [string]$Configuration.domain
    $projectId = [string]$Configuration.projects.$Environment.projectId
    if ($domain -notmatch '^https://[^/]+/?$') {
        throw 'Workspace .infisical.json must specify an HTTPS domain.'
    }
    if ($projectId -notmatch '^[0-9a-fA-F-]{36}$') {
        throw "Workspace .infisical.json must specify a valid project ID for $Environment."
    }

    [pscustomobject]@{
        domain = $domain.TrimEnd('/')
        projectId = $projectId
    }
}

function New-InfisicalCliWorkspace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidatePattern('^[0-9a-fA-F-]{36}$')]
        [string]$ProjectId,

        [Parameter(Mandatory = $true)]
        [ValidatePattern('^https://[^/]+/?$')]
        [string]$Domain,

        [Parameter(Mandatory = $true)]
        [string]$WorkspaceRoot
    )

    $temporaryRoot = Join-Path $WorkspaceRoot '.tmp'
    $null = New-Item -ItemType Directory -Path $temporaryRoot -Force
    $workspacePath = Join-Path $temporaryRoot "infisical-cli-$([guid]::NewGuid().ToString('N'))"
    $null = New-Item -ItemType Directory -Path $workspacePath
    $cliConfiguration = @{
        workspaceId = $ProjectId
        domain = $Domain.TrimEnd('/')
        defaultEnvironment = ''
        gitBranchToEnvironmentMapping = $null
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $workspacePath '.infisical.json'), $cliConfiguration, [System.Text.UTF8Encoding]::new($false))
    return $workspacePath
}

function Invoke-InfisicalCli {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath,

        [Parameter(Mandatory = $true)]
        [string]$Domain,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Push-Location -LiteralPath $WorkspacePath
    try {
        & infisical --domain=$Domain --silent @Arguments *> $null
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

function Remove-InfisicalCliWorkspace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$WorkspaceRoot
    )

    $temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot '.tmp'))
    $workspacePath = [System.IO.Path]::GetFullPath($Path)
    if (-not $workspacePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove an Infisical CLI workspace outside the workspace .tmp directory.'
    }
    if (Test-Path -LiteralPath $workspacePath -PathType Container) {
        Remove-Item -LiteralPath $workspacePath -Recurse -Force
    }
}
