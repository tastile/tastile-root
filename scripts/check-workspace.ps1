param(
    [ValidateSet("core", "web", "android", "desktop", "brands")]
    [string[]]$Repository = @("core", "web", "android", "desktop", "brands"),
    [ValidateSet("fast", "full")]
    [string]$Profile = "fast",
    [ValidateRange(1, 5)]
    [int]$MaxAttempts = 1,
    [switch]$KeepGoing,
    [switch]$ListOnly,
    [string]$ResultPath,
    [string]$WorkspaceRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function New-Step {
    param([string]$Name, [string]$Path, [string]$Command, [string[]]$Arguments)
    [pscustomobject]@{ Name = $Name; Path = $Path; Command = $Command; Arguments = $Arguments }
}

function Get-Steps {
    param([string]$Name, [string]$SelectedProfile)
    switch ($Name) {
        "core" {
            if ($SelectedProfile -eq "fast") {
                return @(New-Step $Name "tastile-core" "cargo" @("test", "-p", "domain"))
            }
            return @(New-Step $Name "tastile-core" "pwsh" @("-NoProfile", "-File", "scripts/check.ps1"))
        }
        "web" {
            $script = if ($SelectedProfile -eq "full") { "check:release" } else { "check" }
            return @(New-Step $Name "tastile-web" "bun" @("run", $script))
        }
        "android" {
            $arguments = @("verify", "--no-daemon")
            if ($SelectedProfile -eq "full") { $arguments = @("verify", "assembleDebug", "--no-daemon") }
            return @(New-Step $Name "tastile-android" ".\gradlew.bat" $arguments)
        }
        "desktop" {
            $arguments = @("-NoProfile", "-File", "scripts/check.ps1")
            if ($SelectedProfile -eq "fast") { $arguments += "-SkipDesktopBuild" }
            return @(New-Step $Name "tastile-desktop" "pwsh" $arguments)
        }
        "brands" { return @(New-Step $Name "tastile-brands" "bun" @("run", "verify")) }
    }
}

function Resolve-AndroidJavaHome {
    $candidates = @(
        $env:JAVA_HOME,
        "C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot",
        "C:\Program Files\Microsoft\jdk-17.0.14.7-hotspot"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "bin\java.exe")) }
    foreach ($candidate in $candidates) {
        $version = & (Join-Path $candidate "bin\java.exe") -version 2>&1 | Out-String
        if ($version -match 'version "(17|21)(?:\.|\")') { return $candidate }
    }
    return $null
}

function Invoke-Step {
    param([pscustomobject]$Step, [int]$Attempt)
    $path = Join-Path $WorkspaceRoot $Step.Path
    if (-not (Test-Path -LiteralPath $path)) {
        return [pscustomobject]@{
            repository = $Step.Name; attempt = $Attempt; status = "blocked"; exitCode = 2
            durationMs = 0; command = "$($Step.Command) $($Step.Arguments -join ' ')"
            reason = "Repository path not found: $path"
        }
    }

    $oldJavaHome = $env:JAVA_HOME
    $oldPath = $env:PATH
    if ($Step.Name -eq "android") {
        $javaHome = Resolve-AndroidJavaHome
        if (-not $javaHome) {
            return [pscustomobject]@{
                repository = $Step.Name; attempt = $Attempt; status = "blocked"; exitCode = 2
                durationMs = 0; command = "$($Step.Command) $($Step.Arguments -join ' ')"
                reason = "JDK 17 or 21 is required"
            }
        }
        $env:JAVA_HOME = $javaHome
        $env:PATH = "$(Join-Path $javaHome 'bin');$oldPath"
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $path
    try {
        & $Step.Command @($Step.Arguments) 2>&1 | ForEach-Object { Write-Host $_ }
        $exitCode = $LASTEXITCODE
    } catch {
        Write-Error $_ -ErrorAction Continue
        $exitCode = 1
    } finally {
        Pop-Location
        $env:JAVA_HOME = $oldJavaHome
        $env:PATH = $oldPath
        $stopwatch.Stop()
    }
    [pscustomobject]@{
        repository = $Step.Name; attempt = $Attempt
        status = if ($exitCode -eq 0) { "passed" } elseif ($exitCode -eq 2) { "blocked" } else { "failed" }
        exitCode = $exitCode; durationMs = $stopwatch.ElapsedMilliseconds
        command = "$($Step.Command) $($Step.Arguments -join ' ')"
        reason = if ($exitCode -eq 2) { "Repository prerequisite is not configured" } else { $null }
    }
}

$selected = @($Repository | Select-Object -Unique)
$catalog = @($selected | ForEach-Object { Get-Steps $_ $Profile })
if ($ListOnly) {
    $catalog | ConvertTo-Json -Depth 4
    exit 0
}

$results = [System.Collections.Generic.List[object]]::new()
$pending = @($selected)
for ($attempt = 1; $attempt -le $MaxAttempts -and $pending.Count -gt 0; $attempt++) {
    $nextPending = @()
    for ($index = 0; $index -lt $pending.Count; $index++) {
        $name = $pending[$index]
        Write-Host "==> [$attempt/$MaxAttempts] $name ($Profile)"
        $step = Get-Steps $name $Profile
        $result = Invoke-Step $step $attempt
        $results.Add($result)
        if ($result.status -eq "failed") { $nextPending += $name }
        if ($result.status -ne "passed" -and -not $KeepGoing) {
            if ($result.status -eq "failed" -and $index + 1 -lt $pending.Count) {
                $nextPending += $pending[($index + 1)..($pending.Count - 1)]
            }
            break
        }
    }
    $pending = @($nextPending | Select-Object -Unique)
}

$latest = @{}
foreach ($result in $results) { $latest[$result.repository] = $result }
$summary = [pscustomobject]@{
    profile = $Profile
    maxAttempts = $MaxAttempts
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    results = @($results)
    final = @($selected | ForEach-Object {
        if ($latest.ContainsKey($_)) { $latest[$_] } else {
            [pscustomobject]@{ repository = $_; status = "not_run"; exitCode = 2; reason = "Stopped after an earlier failure" }
        }
    })
}
$json = $summary | ConvertTo-Json -Depth 6
if ($ResultPath) {
    $parent = Split-Path -Parent $ResultPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($ResultPath, $json)
}
$json

if (@($summary.final | Where-Object { $_.status -eq "failed" }).Count -gt 0) { exit 1 }
if (@($summary.final | Where-Object { $_.status -ne "passed" }).Count -gt 0) { exit 2 }
exit 0
