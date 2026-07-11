$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$adapter = Join-Path $root ".agent-loop\Invoke-AgentHook.ps1"
$claudeSettings = Join-Path $root ".claude\settings.json"
$codexHooks = Join-Path $root ".codex\hooks.json"
$openCodePlugin = Join-Path $root ".opencode\plugins\tastile-precommit-review.js"
$pwsh = (Get-Process -Id $PID).Path

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

foreach ($path in @($adapter, $claudeSettings, $codexHooks, $openCodePlugin)) {
    Assert-True (Test-Path -LiteralPath $path) "Required adapter is missing: $path"
}

$claude = Get-Content -Raw -LiteralPath $claudeSettings | ConvertFrom-Json
$claudeGroup = @($claude.hooks.PreToolUse)[0]
$claudeHook = @($claudeGroup.hooks)[0]
Assert-True ($claudeGroup.matcher -eq "Bash") "Claude must inspect every Bash call"
Assert-True ($claudeHook.type -eq "command") "Claude adapter must be a command hook"
Assert-True ($claudeHook.command -match 'Invoke-AgentHook\.ps1.+Caller claude') "Claude caller identity is missing"
Assert-True ([int]$claudeHook.timeout -ge 900) "Claude hook timeout is too short for gate plus review"

$codex = Get-Content -Raw -LiteralPath $codexHooks | ConvertFrom-Json
$codexGroup = @($codex.hooks.PreToolUse)[0]
$codexHook = @($codexGroup.hooks)[0]
Assert-True ($codexGroup.matcher -eq "Bash") "Codex must inspect every Bash call"
Assert-True ($codexHook.type -eq "command") "Codex adapter must be a command hook"
Assert-True ($codexHook.command -match 'Invoke-AgentHook\.ps1.+Caller codex') "Codex caller identity is missing"
Assert-True ($codexHook.commandWindows -match 'Invoke-AgentHook\.ps1.+Caller codex') "Codex Windows command is missing"
Assert-True ([int]$codexHook.timeout -ge 900) "Codex hook timeout is too short for gate plus review"

$codexHookInput = @{
    cwd = (Join-Path $root "tastile-web")
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{ command = "git status" }
} | ConvertTo-Json -Depth 4 -Compress
$originalLocation = Get-Location
try {
    Push-Location (Join-Path $root "tastile-web")
    $codexHookInput | cmd /d /c $codexHook.commandWindows | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Codex hook must resolve the adapter when the session starts in a subdirectory"
} finally {
    Pop-Location
}

$plugin = Get-Content -Raw -LiteralPath $openCodePlugin
Assert-True ($plugin.Contains('"tool.execute.before"')) "OpenCode must use tool.execute.before"
Assert-True ($plugin.Contains('input.tool !== "bash"')) "OpenCode must route every Bash call"
Assert-True ($plugin.Contains('"opencode"')) "OpenCode caller identity is missing"
Assert-True ($plugin.Contains("Invoke-AgentHook.ps1")) "OpenCode must invoke the common adapter"
Assert-True ($plugin.Contains("throw new Error")) "OpenCode must propagate denial"

$allowInput = @{
    cwd = $root
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{ command = "git status" }
} | ConvertTo-Json -Depth 4 -Compress
$allowInput | & $pwsh -NoProfile -File $adapter -Caller claude 2>$null | Out-Null
Assert-True ($LASTEXITCODE -eq 0) "Adapter must allow a safe non-commit command"

$denyInput = @{
    cwd = $root
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{ command = "cmd /c echo indirect" }
} | ConvertTo-Json -Depth 4 -Compress
$denyInput | & $pwsh -NoProfile -File $adapter -Caller codex 2>$null | Out-Null
Assert-True ($LASTEXITCODE -eq 2) "Adapter must translate engine denial to hook exit code 2"

$badInput = '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{}}'
$badInput | & $pwsh -NoProfile -File $adapter -Caller opencode 2>$null | Out-Null
Assert-True ($LASTEXITCODE -eq 2) "Malformed hook input must fail closed"

$arrayCommand = @{
    cwd = $root
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{ command = @("git", "status") }
} | ConvertTo-Json -Depth 4 -Compress
$arrayCommand | & $pwsh -NoProfile -File $adapter -Caller claude 2>$null | Out-Null
Assert-True ($LASTEXITCODE -eq 2) "Non-string command input must fail closed"

$fileCwd = @{
    cwd = $adapter
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{ command = "git status" }
} | ConvertTo-Json -Depth 4 -Compress
$fileCwd | & $pwsh -NoProfile -File $adapter -Caller codex 2>$null | Out-Null
Assert-True ($LASTEXITCODE -eq 2) "Working directory must be a directory"

Write-Output "Agent adapter tests passed"
