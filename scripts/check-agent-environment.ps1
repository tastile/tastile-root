$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$errors = [System.Collections.Generic.List[string]]::new()

function Add-CheckError {
    param([string]$Message)
    $errors.Add($Message)
    Write-Error $Message -ErrorAction Continue
}

function Test-RequiredFile {
    param([string]$RelativePath)
    if (-not (Test-Path -LiteralPath (Join-Path $root $RelativePath) -PathType Leaf)) {
        Add-CheckError "Required file is missing: $RelativePath"
    }
}

function Test-JsonDocument {
    param([string]$RelativePath)
    $path = Join-Path $root $RelativePath
    try {
        Get-Content -Raw -LiteralPath $path | ConvertFrom-Json | Out-Null
    } catch {
        Add-CheckError "Invalid JSON: $RelativePath ($($_.Exception.Message))"
    }
}

function Test-IgnoreRule {
    param([string]$Probe, [bool]$ShouldBeIgnored)
    & git -C $root check-ignore --quiet --no-index $Probe
    $ignored = $LASTEXITCODE -eq 0
    if ($ignored -ne $ShouldBeIgnored) {
        $expectation = if ($ShouldBeIgnored) { "ignored" } else { "tracked-capable" }
        Add-CheckError "Ignore policy mismatch: $Probe must be $expectation"
    }
}

$requiredFiles = @(
    "AGENTS.md",
    "CLAUDE.md",
    ".mcp.json",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".codex/agents/cross-repo-contract-reviewer.toml",
    ".codex/agents/luna-implementer.toml",
    ".codex/agents/sol-supervisor.toml",
    ".codex/agents/tastile-verifier.toml",
    ".codex/agents/terra-inspector.toml",
    ".claude/settings.json",
    ".claude/agents/cross-repo-contract-reviewer.md",
    ".claude/agents/tastile-verifier.md",
    ".claude/skills/cross-repo-contract-check/SKILL.md",
    ".claude/skills/verify-tastile-change/SKILL.md",
    ".agents/skills/cross-repo-contract-check/SKILL.md",
    ".agents/skills/tastile-precommit-review/SKILL.md",
    ".agents/skills/verify-tastile-change/SKILL.md",
    ".agents/skills/plugin-version-audit/SKILL.md",
    "CODEX_ROLES.ja.md",
    "docs/adr/0001-agent-toolchain.md",
    "docs/adr/0004-context7-mcp.md",
    "docs/adr/0005-skills-and-mcp-extensions.md",
    "scripts/audit-plugin-versions.mjs",
    "tastile-web/.agents/skills/i18n-literal-guard/SKILL.md",
    "tastile-web/scripts/audit-i18n-literals.mts"
)
foreach ($file in $requiredFiles) { Test-RequiredFile $file }

foreach ($file in @(".mcp.json", ".codex/hooks.json", ".claude/settings.json")) {
    if (Test-Path -LiteralPath (Join-Path $root $file)) { Test-JsonDocument $file }
}

$configText = @(
    Get-Content -Raw -LiteralPath (Join-Path $root ".mcp.json")
    Get-Content -Raw -LiteralPath (Join-Path $root ".codex/config.toml")
) -join "`n"
if ($configText -match '@latest') {
    Add-CheckError "Agent runtime dependencies must be pinned; found @latest"
}

$mcpJsonText = Get-Content -Raw -LiteralPath (Join-Path $root ".mcp.json")
$codexTomlText = Get-Content -Raw -LiteralPath (Join-Path $root ".codex/config.toml")
foreach ($probe in @("chrome-devtools", "context7")) {
    if ($mcpJsonText -notmatch [regex]::Escape("`"$probe`"")) {
        Add-CheckError ".mcp.json must declare mcpServer: $probe"
    }
    if ($codexTomlText -notmatch [regex]::Escape("mcp_servers.$probe")) {
        Add-CheckError ".codex/config.toml must declare [mcp_servers.$probe]"
    }
}

$claudeAdapter = Get-Content -Raw -LiteralPath (Join-Path $root "CLAUDE.md")
if ($claudeAdapter -notmatch 'AGENTS\.md') {
    Add-CheckError "CLAUDE.md must route to canonical AGENTS.md"
}

$trackedPowerShell = @(& git -C $root ls-files "*.ps1")
foreach ($relativePath in $trackedPowerShell) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $root $relativePath),
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    foreach ($parseError in @($parseErrors)) {
        Add-CheckError "PowerShell parse error: ${relativePath}:$($parseError.Extent.StartLineNumber) $($parseError.Message)"
    }
}

Test-IgnoreRule ".tmp/probe.log" $true
Test-IgnoreRule ".reference/probe.txt" $true
Test-IgnoreRule ".env" $true
Test-IgnoreRule ".env.development" $true
Test-IgnoreRule ".env.production" $true
Test-IgnoreRule ".env.local" $true
Test-IgnoreRule ".env.example" $false
Test-IgnoreRule "scripts/probe.ps1" $false
Test-IgnoreRule "docs/probe.txt" $false
Test-IgnoreRule ".codex/config.toml" $false
Test-IgnoreRule ".codex/agents/tastile-verifier.toml" $false

if ($errors.Count -gt 0) {
    Write-Host "Agent environment check failed: $($errors.Count) error(s)."
    exit 1
}

Write-Host "Agent environment check passed."
exit 0
