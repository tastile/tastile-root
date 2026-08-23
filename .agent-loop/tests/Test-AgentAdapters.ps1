$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$adapter = Join-Path $root ".agent-loop\Invoke-AgentHook.ps1"
$claudeSettings = Join-Path $root ".claude\settings.json"
$codexHooks = Join-Path $root ".codex\hooks.json"
$pwsh = (Get-Process -Id $PID).Path

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

foreach ($path in @($adapter, $claudeSettings, $codexHooks)) {
    Assert-True (Test-Path -LiteralPath $path) "Required adapter is missing: $path"
}

$claudeDispatcher = Join-Path $root ".claude\hooks\hook-dispatch.mjs"

$claude = Get-Content -Raw -LiteralPath $claudeSettings | ConvertFrom-Json
$claudeGroup = @($claude.hooks.PreToolUse)[0]
$claudeHook = @($claudeGroup.hooks)[0]
$claudeArgs = @($claudeHook.args)
Assert-True ($claudeGroup.matcher -eq "Bash") "Claude must inspect every Bash call"
Assert-True ($claudeHook.type -eq "command") "Claude adapter must be a command hook"
Assert-True ($claudeHook.command -eq "bun") "Claude hook must launch the dispatcher through bun"
Assert-True ($claudeArgs.Count -ge 1 -and $claudeArgs[0].EndsWith('hook-dispatch.mjs')) "Claude hook must point at hook-dispatch.mjs"
$claudeHookCommandLine = ($claudeHook.command + " " + ($claudeArgs -join " "))
Assert-True (-not $claudeHookCommandLine.Contains('C:\\Users\\rebui\\Desktop\\tastile')) "Claude hook must not contain a fixed absolute path"
Assert-True ([int]$claudeHook.timeout -ge 900) "Claude hook timeout is too short for gate plus review"

$dispatcherSource = Get-Content -Raw -LiteralPath $claudeDispatcher
Assert-True ($dispatcherSource.Contains('Invoke-AgentHook.ps1')) "Dispatcher must invoke the agent hook for commit-shaped commands"
Assert-True ($dispatcherSource.Contains('"-Caller"') -and $dispatcherSource.Contains('"claude"')) "Dispatcher must identify Claude as the caller"

$codex = Get-Content -Raw -LiteralPath $codexHooks | ConvertFrom-Json
$codexGroup = @($codex.hooks.PreToolUse)[0]
$codexHook = @($codexGroup.hooks)[0]
Assert-True ($codexGroup.matcher -eq "Bash") "Codex must inspect every Bash call"
Assert-True ($codexHook.type -eq "command") "Codex adapter must be a command hook"
Assert-True ($codexHook.command -match 'Get-Location.+\.agent-loop\\Invoke-AgentHook\.ps1.+Caller codex') "Codex hook must search parent directories"
Assert-True ($codexHook.commandWindows -match 'Invoke-AgentHook\.ps1.+Caller codex') "Codex Windows command is missing"
Assert-True (-not $codexHook.command.Contains('C:\\Users\\rebui\\Desktop\\tastile')) "Codex hook must not contain a fixed absolute path"
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
    $codexHookInput | cmd /d /c ($claudeHook.command + " " + $claudeDispatcher) | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Claude hook must resolve the adapter when the session starts in a subdirectory"
    $codexHookInput | cmd /d /c $codexHook.commandWindows | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Codex hook must resolve the adapter when the session starts in a subdirectory"
} finally {
    Pop-Location
}

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
