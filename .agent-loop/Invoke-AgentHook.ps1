param(
    [Parameter(Mandatory)]
    [ValidateSet("claude", "codex", "opencode")]
    [string]$Caller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Deny-Hook([string]$Reason) {
    [Console]::Error.WriteLine($Reason)
    exit 2
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { Deny-Hook "Tastile review hook received no input" }
    try { $inputObject = $raw | ConvertFrom-Json } catch {
        Deny-Hook "Tastile review hook received invalid JSON"
    }

    if ($inputObject.hook_event_name -ne "PreToolUse" -or $inputObject.tool_name -ne "Bash") {
        Deny-Hook "Tastile review hook received an unexpected event"
    }
    if ($inputObject.tool_input.command -isnot [string]) {
        Deny-Hook "Tastile review hook received a non-string Bash command"
    }
    $command = [string]$inputObject.tool_input.command
    if ([string]::IsNullOrWhiteSpace($command)) { Deny-Hook "Tastile review hook received no Bash command" }
    if ($inputObject.cwd -isnot [string]) {
        Deny-Hook "Tastile review hook received a non-string working directory"
    }
    $cwd = [string]$inputObject.cwd
    if ([string]::IsNullOrWhiteSpace($cwd) -or -not (Test-Path -LiteralPath $cwd -PathType Container)) {
        Deny-Hook "Tastile review hook received an invalid working directory"
    }

    $engine = Join-Path $PSScriptRoot "Invoke-PreCommitReview.ps1"
    $output = & (Get-Process -Id $PID).Path -NoProfile -File $engine `
        -Caller $Caller -Command $command -WorkingDirectory $cwd 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { exit 0 }

    $reason = "Tastile pre-commit review denied this command"
    try {
        $decision = ($output -join "`n") | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string]$decision.reason)) {
            $reason = [string]$decision.reason
        }
    } catch { }
    Deny-Hook $reason
} catch {
    Deny-Hook "Tastile review hook failed closed: $($_.Exception.Message)"
}
