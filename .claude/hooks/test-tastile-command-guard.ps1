Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Guard = Join-Path $PSScriptRoot 'tastile-command-guard.ps1'

$cases = @(
    @{ Name = 'BLOCK npm install'; Command = 'npm install'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK npm run'; Command = 'npm run test'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK npx'; Command = 'npx prettier .'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK Windows cargo in core'; Command = 'cargo test'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK unrelated WSL segment'; Command = 'printf wsl --exec; cargo test'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK cargo toolchain test'; Command = 'cargo +stable test'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK cargo global options check'; Command = 'cargo --locked --color always check'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'ALLOW wslc cargo'; Command = 'wslc container run --rm tastile-v1-api cargo test'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'allow' }
    @{ Name = 'BLOCK wsl exec cargo'; Command = "wsl --exec bash -lc 'cd /workspace/tastile-core && cargo test'"; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK yarn install'; Command = 'yarn install'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK pnpm install'; Command = 'pnpm install'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'ALLOW bun install'; Command = 'bun install'; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'ALLOW bun run'; Command = 'bun run test'; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'ALLOW bunx'; Command = 'bunx prettier .'; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'BLOCK Android non-17'; Command = './gradlew test'; Cwd = (Join-Path $Root 'tastile-android'); Expect = 'deny'; JavaHome = 'C:\Program Files\Java\jdk-11' }
    @{ Name = 'BLOCK root Android non-17'; Command = './tastile-android/gradlew -p tastile-android test'; Cwd = $Root; Expect = 'deny'; JavaHome = 'C:\Program Files\Java\jdk-11' }
    @{ Name = 'BLOCK nonexistent JDK17 pin'; Command = './gradlew test'; Cwd = (Join-Path $Root 'tastile-android'); Expect = 'deny'; JavaHome = 'C:\Program Files\Java\jdk-11'; GradleProperties = "org.gradle.java.home=C:\missing\jdk-17`n" }
    @{ Name = 'ALLOW verified JDK17 pin'; Command = './gradlew test'; Cwd = (Join-Path $Root 'tastile-android'); Expect = 'allow'; JavaHome = 'C:\Program Files\Java\jdk-11'; FakeJava17 = $true }
    @{ Name = 'BLOCK root multi-child mutation'; Command = 'git -C tastile-core status; git -C tastile-web add .'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK root child add'; Command = 'git add tastile-core/src tastile-web/src'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'ALLOW child-local mutation'; Command = 'git add src'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'allow' }
    @{ Name = 'ALLOW read-only children'; Command = 'git -C tastile-core status; git -C tastile-web diff; git -C tastile-android log -1'; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'ALLOW harmless'; Command = 'printf hello'; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'ALLOW malformed JSON'; RawPayload = '{not-json'; Expect = 'allow' }
    @{ Name = 'BLOCK core cargo run'; Command = 'cargo run'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK core cargo bench'; Command = 'cargo bench'; Cwd = (Join-Path $Root 'tastile-core'); Expect = 'deny' }
    @{ Name = 'BLOCK root git commit child'; Command = 'git commit -m msg tastile-core/src/lib.rs'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'BLOCK npm with Windows path'; Command = 'npm install C:\Users\me\pkg'; Cwd = $Root; Expect = 'deny' }
    @{ Name = 'ALLOW empty command'; Command = ''; Cwd = $Root; Expect = 'allow' }
    @{ Name = 'ALLOW whitespace command'; Command = '   '; Cwd = $Root; Expect = 'allow' }
)

function Invoke-Case($case) {
    $oldJavaHome = $env:JAVA_HOME
    $tempProps = $null
    $tempJdk = $null
    try {
        if ($case.ContainsKey('JavaHome')) { $env:JAVA_HOME = $case.JavaHome }
        if ($case.ContainsKey('FakeJava17')) {
            $tempJdk = Join-Path ([IO.Path]::GetTempPath()) ('jdk-' + [guid]::NewGuid().ToString('N'))
            $bin = Join-Path $tempJdk 'bin'
            New-Item -ItemType Directory -Path $bin | Out-Null
            $fakeJava = Join-Path $bin 'java.cmd'
            [IO.File]::WriteAllText($fakeJava, "@echo off`r`necho openjdk version `"17.0.12`" 1^>^&2`r`n")
            $case.GradleProperties = "org.gradle.java.home=$tempJdk`n"
        }
        if ($case.ContainsKey('GradleProperties')) {
            $tempProps = Join-Path ([IO.Path]::GetTempPath()) ('gradle-' + [guid]::NewGuid().ToString('N') + '.properties')
            [IO.File]::WriteAllText($tempProps, $case.GradleProperties)
            $env:TASTILE_GUARD_GRADLE_PROPERTIES = $tempProps
        } else { Remove-Item Env:TASTILE_GUARD_GRADLE_PROPERTIES -ErrorAction SilentlyContinue }

        $payload = if ($case.ContainsKey('RawPayload')) { $case.RawPayload } else {
            @{ tool_input = @{ command = $case.Command }; cwd = $case.Cwd } | ConvertTo-Json -Compress
        }
        $output = @($payload | & pwsh -NoProfile -File $Guard 2>&1)
        $exitCode = $LASTEXITCODE
        $joined = $output -join "`n"
        if ($case.Expect -eq 'allow') {
            if ($joined.Length -ne 0 -or $exitCode -ne 0) {
                throw "$($case.Name): expected no output and exit 0, got '$joined' (exit $exitCode)"
            }
            $decision = 'allow'
        } else {
            try { $result = $joined | ConvertFrom-Json } catch { throw "$($case.Name): invalid deny JSON" }
            $canonical = $result | ConvertTo-Json -Compress
            if ($canonical -notmatch '^\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":".+"\}\}$' -or $exitCode -ne 0) {
                throw "$($case.Name): deny output did not match the exact hook schema (exit $exitCode)"
            }
            $decision = 'deny'
        }
        "PASS $($case.Name): $decision"
    } finally {
        if ($null -eq $oldJavaHome) { Remove-Item Env:JAVA_HOME -ErrorAction SilentlyContinue } else { $env:JAVA_HOME = $oldJavaHome }
        Remove-Item Env:TASTILE_GUARD_GRADLE_PROPERTIES -ErrorAction SilentlyContinue
        if ($tempProps) { Remove-Item -LiteralPath $tempProps -Force -ErrorAction SilentlyContinue }
        if ($tempJdk) { Remove-Item -LiteralPath $tempJdk -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$failures = 0
foreach ($case in $cases) {
    try { Invoke-Case $case } catch { $failures++; "FAIL $($_.Exception.Message)" }
}
if ($failures -gt 0) { exit 1 }
