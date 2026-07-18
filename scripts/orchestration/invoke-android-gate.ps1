[CmdletBinding()]
param([Parameter(Mandatory)][uri]$CoreUrl,[switch]$WhatIf)
$ErrorActionPreference='Stop';$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path;$dir=Join-Path $root 'tastile-android';$gradle=Join-Path $dir 'gradlew.bat'
if($WhatIf){"would run ${gradle} test; require adb device; then connectedDebugAndroidTest against CoreUrl=$CoreUrl";return}
Push-Location $dir;try{& $gradle test;if($LASTEXITCODE){throw "Android unit tests failed: $LASTEXITCODE"};$devices=& adb devices;if($LASTEXITCODE -or -not($devices -match "`tdevice$")){throw 'NOT IMPLEMENTED: no connected adb device/emulator for Android contract gate.'};& $gradle connectedDebugAndroidTest ("-PcoreUrl="+$CoreUrl.AbsoluteUri.TrimEnd('/'));if($LASTEXITCODE){throw "Android connected contract tests failed: $LASTEXITCODE"}}finally{Pop-Location}
