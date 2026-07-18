[CmdletBinding()]
param([Parameter(Mandatory)][uri]$ApiUrl,[Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunNamespace,[switch]$WhatIf)
$ErrorActionPreference='Stop'
if($WhatIf){"would verify existing WSLC namespace '$RunNamespace' only: GET $($ApiUrl.AbsoluteUri.TrimEnd('/'))/health; assert namespaced API and worker in wslc container list";return}
try{$health=Invoke-WebRequest -Uri ($ApiUrl.AbsoluteUri.TrimEnd('/')+'/health') -UseBasicParsing -TimeoutSec 15;if($health.StatusCode -ne 200){throw "health returned $($health.StatusCode)"}}catch{throw "WSLC API readiness failed: $($_.Exception.Message)"}
$stack=& wslc list 2>&1;if($LASTEXITCODE){throw "WSLC inspection failed: $LASTEXITCODE"};$containers=& wslc container list 2>&1;if($LASTEXITCODE){throw "WSLC worker inspection failed: $LASTEXITCODE"}
$namespace=[regex]::Escape($RunNamespace);$apiRunning=$false;$workerRunning=$false;foreach($line in @($containers)){if($line -match "(?i)$namespace" -and $line -match '(?i)running'){if($line -match '(?i)api'){$apiRunning=$true};if($line -match '(?i)worker'){$workerRunning=$true}}};if(-not $apiRunning){throw "WSLC namespace '$RunNamespace' lacks a running namespaced API container."};if(-not $workerRunning){throw "WSLC namespace '$RunNamespace' lacks a running namespaced worker container."}
