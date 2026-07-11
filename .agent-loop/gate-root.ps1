$ErrorActionPreference = "Stop"

# Root (workspace) fast gate.
#
# Validates that staged .agent-loop/ JSON and PowerShell changes still parse.
# The hook snapshots the repository into an isolated directory and invokes
# this script there, so every path is relative to the snapshot root.

$root = (Get-Location).Path
$catalogPath = Join-Path $root ".agent-loop/repositories.json"
$schemaPath = Join-Path $root ".agent-loop/review-result.schema.json"

function Test-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error "Required JSON file is missing: $Path"
        return $false
    }
    try {
        Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json | Out-Null
        return $true
    } catch {
        Write-Error "Invalid JSON in $Path : $($_.Exception.Message)"
        return $false
    }
}

function Test-PowerShellFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path -LiteralPath $Path).Path,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if ($parseErrors.Count -gt 0) {
        foreach ($err in @($parseErrors)) {
            Write-Error "PowerShell parse error in $Path : $($err.Message) (line $($err.Extent.StartLineNumber))"
        }
        return $false
    }
    return $true
}

$ok = $true
if (-not (Test-JsonFile $catalogPath)) { $ok = $false }
if (-not (Test-JsonFile $schemaPath)) { $ok = $false }

$psFiles = @(
    Join-Path $root ".agent-loop/Invoke-PreCommitReview.ps1"
    Join-Path $root ".agent-loop/Invoke-AgentHook.ps1"
)
foreach ($ps in $psFiles) {
    if (Test-Path -LiteralPath $ps) {
        if (-not (Test-PowerShellFile $ps)) { $ok = $false }
    }
}

if (-not $ok) { exit 1 }
exit 0