$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$catalog = Get-Content -Raw (Join-Path $root ".agent-loop\repositories.json") | ConvertFrom-Json

$sourceMarkers = @{
    core = "v1/10-invariants.md"
    web = "AGENTS.md"
    android = "README.md"
    desktop = "CLAUDE.md"
    brands = "README.md"
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

foreach ($repository in $catalog.repositories) {
    $skillPath = Join-Path (Join-Path $root $repository.path) $repository.skill
    Assert-True (Test-Path -LiteralPath $skillPath) "Review skill is missing: $skillPath"
    $content = Get-Content -Raw -LiteralPath $skillPath
    $frontmatter = [regex]::Match($content, '(?s)^---\r?\n(.+?)\r?\n---')
    Assert-True $frontmatter.Success "Skill frontmatter is invalid: $skillPath"
    $keys = @([regex]::Matches($frontmatter.Groups[1].Value, '(?m)^([a-zA-Z0-9_-]+):') |
        ForEach-Object { $_.Groups[1].Value })
    Assert-True (($keys -join ",") -eq "name,description") "Skill frontmatter must contain only name and description"
    Assert-True ($content -match '(?m)^name: tastile-precommit-review$') "Skill name is invalid"
    Assert-True ($content -match '(?m)^description: Use when ') "Skill description must state trigger only"
    Assert-True ($content.Contains([string]$sourceMarkers[$repository.name])) "Source-of-truth marker is missing for $($repository.name)"
    $gateCommand = ((@([string]$repository.gate.command) + @($repository.gate.arguments | ForEach-Object { [string]$_ })) -join " ")
    Assert-True ($content.Contains($gateCommand)) "Complete fast gate command is missing for $($repository.name)"
    foreach ($required in @(
        "Critical", "Important", "exact intended patch", "Do not approve",
        "different agent", "Never self-approve"
    )) {
        Assert-True ($content.Contains($required)) "Skill lacks '$required': $skillPath"
    }
    Assert-True (($content -split '\s+').Count -le 500) "Skill must remain concise: $skillPath"
}

$web = @($catalog.repositories | Where-Object { $_.name -eq "web" })[0]
Assert-True (-not ($web.PSObject.Properties.Name -contains "snapshotLinks")) "Web must not link mutable dependencies into a review snapshot"
$webPrepare = ((@([string]$web.prepare.command) + @($web.prepare.arguments | ForEach-Object { [string]$_ })) -join " ")
Assert-True ($webPrepare -eq "bun install --frozen-lockfile --ignore-scripts") "Web snapshot preparation must use the reviewed lockfile without lifecycle scripts"

Write-Output "Review skill tests passed"
