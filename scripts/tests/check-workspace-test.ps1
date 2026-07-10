$ErrorActionPreference = "Stop"
$scriptPath = Resolve-Path (Join-Path $PSScriptRoot "..\check-workspace.ps1")
$pwsh = (Get-Process -Id $PID).Path
$temp = Join-Path $env:TEMP ("tastile-workspace-test-" + [guid]::NewGuid().ToString("N"))
$fakeBin = Join-Path $temp "bin"
$workspace = Join-Path $temp "workspace"
$resultPath = Join-Path $temp "result.json"
$originalPath = $env:PATH

try {
    New-Item -ItemType Directory -Force -Path $fakeBin, (Join-Path $workspace "tastile-brands") | Out-Null
    @"
@echo off
exit /b %FAKE_BUN_EXIT%
"@ | Set-Content -Path (Join-Path $fakeBin "bun.cmd") -Encoding Ascii
    $env:PATH = "$fakeBin;$originalPath"

    $catalogText = & $pwsh -NoProfile -File $scriptPath -Repository web -ListOnly
    if ($LASTEXITCODE -ne 0) { throw "ListOnly failed" }
    $catalog = $catalogText | ConvertFrom-Json
    if (@($catalog).Count -ne 1 -or $catalog.Name -ne "web") {
        throw "ListOnly repository selection is incorrect"
    }

    $env:FAKE_BUN_EXIT = "23"
    & $pwsh -NoProfile -File $scriptPath -WorkspaceRoot $workspace -Repository brands `
        -MaxAttempts 2 -KeepGoing -ResultPath $resultPath | Out-Null
    if ($LASTEXITCODE -ne 1) { throw "Repeated command failure must exit 1" }
    $failed = Get-Content -Raw $resultPath | ConvertFrom-Json
    if (@($failed.results).Count -ne 2) { throw "Failed repository was not retried twice" }
    if ($failed.final[0].status -ne "failed" -or $failed.final[0].exitCode -ne 23) {
        throw "Failed result did not preserve the native exit code"
    }

    $env:FAKE_BUN_EXIT = "0"
    & $pwsh -NoProfile -File $scriptPath -WorkspaceRoot $workspace -Repository brands `
        -ResultPath $resultPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Successful command must exit 0" }
    $passed = Get-Content -Raw $resultPath | ConvertFrom-Json
    if ($passed.final[0].status -ne "passed") { throw "Successful result was not recorded" }

    & $pwsh -NoProfile -File $scriptPath -WorkspaceRoot $workspace -Repository core `
        -ResultPath $resultPath | Out-Null
    if ($LASTEXITCODE -ne 2) { throw "Missing repository must be reported as blocked" }
} finally {
    $env:PATH = $originalPath
    Remove-Item Env:FAKE_BUN_EXIT -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

Write-Output "check-workspace.ps1 test passed"
