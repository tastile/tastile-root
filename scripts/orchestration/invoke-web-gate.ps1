[CmdletBinding()]
param([Parameter(Mandatory)][uri]$CoreUrl,[switch]$WhatIf)
$ErrorActionPreference='Stop';$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path;$dir=Join-Path $root 'tastile-web'
if($WhatIf){"would run in ${dir}: bun run check; bun run build; bun run test:e2e with CoreUrl=$CoreUrl";return}
$env:TASTILE_RUST_API_URL=$CoreUrl.AbsoluteUri.TrimEnd('/');$env:NEXT_PUBLIC_DAEMON_BASE_URL=$env:TASTILE_RUST_API_URL
Push-Location $dir;try{bun run check;if($LASTEXITCODE){throw "web check failed: $LASTEXITCODE"};bun run build;if($LASTEXITCODE){throw "web build failed: $LASTEXITCODE"};bun run test:e2e;if($LASTEXITCODE){throw "web Playwright failed: $LASTEXITCODE"}}finally{Pop-Location}
