[CmdletBinding()]
param([Parameter(Mandatory)][uri]$CoreUrl,[switch]$WhatIf)
$ErrorActionPreference='Stop';$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path;$dir=Join-Path $root 'tastile-web'
$auditScript=Join-Path $root 'scripts\audit-plugin-versions.mjs'
if($WhatIf){"would run in ${dir}: bun run check; bun ${auditScript} (skip-on-network-blocked); bun run build; bun run test:e2e with CoreUrl=$CoreUrl";return}
$env:TASTILE_RUST_API_URL=$CoreUrl.AbsoluteUri.TrimEnd('/');$env:NEXT_PUBLIC_DAEMON_BASE_URL=$env:TASTILE_RUST_API_URL
Push-Location $dir;try{
    bun run check;if($LASTEXITCODE){throw "web check failed: $LASTEXITCODE"}
    # plugin-version-audit (ADR-0005 D-1): exit 0=PASS, 1=OUTDATED (fail release),
    # 2=BLOCKED (external prerequisite unreachable, do not fail).
    bun $auditScript;$auditExit=$LASTEXITCODE
    if($auditExit -eq 1){throw "web plugin audit OUTDATED: drift detected. Run 'bun $auditScript' for details; bump or pin per ADR-0001 rule, then re-run this gate."}
    elseif($auditExit -ne 0 -and $auditExit -ne 2){throw "web plugin audit error: exit $auditExit"}
    bun run build;if($LASTEXITCODE){throw "web build failed: $LASTEXITCODE"}
    bun run test:e2e;if($LASTEXITCODE){throw "web Playwright failed: $LASTEXITCODE"}
}finally{Pop-Location}