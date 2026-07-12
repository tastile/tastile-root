$ErrorActionPreference = "Stop"
$engine = Join-Path $PSScriptRoot "..\Invoke-PreCommitReview.ps1"
$pwsh = (Get-Process -Id $PID).Path
$temp = Join-Path $env:TEMP ("tastile-agent-loop-test-" + [guid]::NewGuid().ToString("N"))
$workspace = Join-Path $temp "workspace"
$bin = Join-Path $temp "bin"
$config = Join-Path $temp "repositories.json"
$gateLog = Join-Path $temp "gate.log"
$reviewLog = Join-Path $temp "review.log"
$promptLog = Join-Path $temp "prompt.log"
$gitLog = Join-Path $temp "git.log"
$headArchive = Join-Path $temp "head.tar"
$headFixture = Join-Path $temp "head-fixture"
$repositories = @("tastile-core", "tastile-web", "tastile-android", "tastile-desktop", "tastile-brands")

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Clear-Logs {
    Remove-Item $gateLog, $reviewLog, $promptLog, $gitLog -Force -ErrorAction SilentlyContinue
}

function Invoke-Engine {
    param(
        [string]$Command,
        [string]$Caller = "claude",
        [string]$WorkingDirectory = $workspace,
        [bool]$TestMode = $true
    )
    $arguments = @(
        "-NoProfile", "-File", $engine, "-Caller", $Caller, "-Command", $Command,
        "-WorkingDirectory", $WorkingDirectory, "-WorkspaceRoot", $workspace,
        "-RepositoriesPath", $config
    )
    if ($TestMode) { $arguments += "-TestMode" }
    $output = & $pwsh @arguments 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
}

try {
    New-Item -ItemType Directory -Force -Path $workspace, $bin | Out-Null
    foreach ($repository in $repositories) {
        $skillDirectory = Join-Path $workspace "$repository\.agents\skills\tastile-precommit-review"
        New-Item -ItemType Directory -Force -Path $skillDirectory, (Join-Path $workspace "$repository\.git") | Out-Null
        "unstaged-skill-for-$repository" | Set-Content -Path (Join-Path $skillDirectory "SKILL.md") -Encoding utf8
        "unstaged-passing" | Set-Content -Path (Join-Path $workspace "$repository\content.txt") -Encoding ascii
    }
    $headSkillDirectory = Join-Path $headFixture ".agents\skills\tastile-precommit-review"
    New-Item -ItemType Directory -Force -Path $headSkillDirectory | Out-Null
    "snapshot-skill" | Set-Content -Path (Join-Path $headSkillDirectory "SKILL.md") -Encoding utf8
    "head-content" | Set-Content -Path (Join-Path $headFixture "content.txt") -Encoding ascii
    & tar -cf $headArchive -C $headFixture .
    if ($LASTEXITCODE -ne 0) { throw "Failed to create fake HEAD archive" }

    @'
@echo off
pwsh -NoProfile -File "%~dp0fake-git.ps1" %*
exit /b %ERRORLEVEL%
'@ | Set-Content -Path (Join-Path $bin "fake-git.cmd") -Encoding ascii

    @'
$repo = $null
$gitArgs = @($args)
Add-Content -Path $env:FAKE_GIT_LOG -Value ($gitArgs -join " ")
if ($gitArgs.Count -ge 3 -and $gitArgs[0] -eq "-C") {
    $repo = $gitArgs[1]
    $gitArgs = @($gitArgs[2..($gitArgs.Count - 1)])
}
switch ($gitArgs[0]) {
    "rev-parse" {
        if ($gitArgs[1] -eq "--show-toplevel") { $repo; exit 0 }
        if ($gitArgs[1] -eq "--git-dir") { ".git"; exit 0 }
        $env:FAKE_GIT_HEAD
        exit 0
    }
    "diff" { $env:FAKE_GIT_PATCH; exit 0 }
    "archive" {
        $outputIndex = [Array]::IndexOf($gitArgs, "--output")
        Copy-Item -LiteralPath $env:FAKE_HEAD_ARCHIVE -Destination $gitArgs[$outputIndex + 1]
        exit 0
    }
    "apply" {
        Set-Content -Path (Join-Path (Get-Location) "content.txt") -Value $env:FAKE_STAGED_CONTENT -Encoding ascii
        exit 0
    }
}
exit 64
'@ | Set-Content -Path (Join-Path $bin "fake-git.ps1") -Encoding utf8

    @'
@echo off
set CONTENT=
if exist content.txt set /p CONTENT=<content.txt
echo %CD% %CONTENT% %*>>"%FAKE_GATE_LOG%"
if "%CONTENT%"=="%FAKE_GATE_REJECT_CONTENT%" exit /b 31
exit /b %FAKE_GATE_EXIT%
'@ | Set-Content -Path (Join-Path $bin "fake-gate.cmd") -Encoding ascii

    @'
@echo off
echo %*>>"%FAKE_REVIEW_LOG%"
more >"%FAKE_PROMPT_LOG%"
if defined FAKE_REVIEW_OUTPUT echo %FAKE_REVIEW_OUTPUT%
exit /b %FAKE_REVIEW_EXIT%
'@ | Set-Content -Path (Join-Path $bin "fake-reviewer.cmd") -Encoding ascii

    $catalog = [ordered]@{ repositories = @() }
    foreach ($repository in $repositories) {
        $entry = [ordered]@{
            name = $repository.Replace("tastile-", "")
            path = $repository
            skill = ".agents/skills/tastile-precommit-review/SKILL.md"
            gate = [ordered]@{ command = (Join-Path $bin "fake-gate.cmd"); arguments = @("--fast") }
        }
        if ($repository -eq "tastile-web") {
            $entry.prepare = [ordered]@{ command = (Join-Path $bin "fake-gate.cmd"); arguments = @("--prepare") }
        }
        $catalog.repositories += $entry
    }
    $catalog | ConvertTo-Json -Depth 6 | Set-Content -Path $config -Encoding utf8

    $env:AGENT_LOOP_GIT_COMMAND = Join-Path $bin "fake-git.cmd"
    $env:AGENT_LOOP_REVIEWER_COMMAND = Join-Path $bin "fake-reviewer.cmd"
    $env:FAKE_GIT_LOG = $gitLog
    $env:FAKE_GATE_LOG = $gateLog
    $env:FAKE_REVIEW_LOG = $reviewLog
    $env:FAKE_PROMPT_LOG = $promptLog
    $env:FAKE_HEAD_ARCHIVE = $headArchive
    $env:FAKE_GIT_HEAD = "0123456789abcdef"
    $env:FAKE_GIT_PATCH = "diff --git a/file b/file +change-one"
    $env:FAKE_STAGED_CONTENT = "staged-content"
    $env:FAKE_GATE_REJECT_CONTENT = "never-reject"
    $env:FAKE_GATE_EXIT = "0"
    $env:FAKE_REVIEW_EXIT = "0"
    $env:FAKE_REVIEW_OUTPUT = '{"verdict":"approve","summary":"safe","findings":[]}'

    Clear-Logs
    $result = Invoke-Engine "git status"
    Assert-True ($result.ExitCode -eq 0) "Non-commit command must pass through"
    Assert-True (-not (Test-Path $gateLog)) "Non-commit command must not run a gate"
    Assert-True (-not (Test-Path $reviewLog)) "Non-commit command must not run a reviewer"

    Clear-Logs
    $result = Invoke-Engine "bun run check"
    Assert-True ($result.ExitCode -eq 0) "Ordinary simple non-commit commands must pass through"

    foreach ($unsafeBoundary in @(
        "cmd /c echo safe", "cmd.exe /v:on /c !COMMAND!", "powershell -EncodedCommand ZQBjAGgAbwAgAHgA",
        "pwsh -Command echo safe", "bash -c echo", "sh -c echo", "zsh -c echo", "wsl echo safe",
        'python -c "import subprocess"', 'node -e "require(''child_process'')"',
        "call git commit", 'command git commit', 'env git commit', '& $command', '$command commit',
        '%COMMAND% commit', '!COMMAND! commit', 'g commit', 'Set-Alias g git',
        '.\git.exe commit -m test', 'C:\tmp\git.exe commit -m test'
    )) {
        Clear-Logs
        $result = Invoke-Engine $unsafeBoundary
        Assert-True ($result.ExitCode -ne 0) "Interpreter, wrapper, expansion, alias, or indirect executable must be denied: $unsafeBoundary"
        Assert-True (-not (Test-Path $gitLog) -and -not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Unsafe boundary must stop before processes"
    }

    Clear-Logs
    $result = Invoke-Engine "git status && echo commit"
    Assert-True ($result.ExitCode -eq 0) "A later non-Git commit token must not be treated as git commit"
    Assert-True (-not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "False-positive commit detection must have no side effects"

    foreach ($unsafeShell in @(
        "git -C tastile-web commit -m test && echo done",
        "echo start && git -C tastile-web commit -m test",
        "git -C tastile-web commit -m one; git -C tastile-web commit -m two",
        'cmd /c "git -C tastile-web commit -m test"',
        'cmd.exe /c "git -C tastile-web commit -m test"',
        'env git -C tastile-web commit -m test',
        'pwsh -Command "git -C tastile-web commit -m test"',
        'bash -c "git -C tastile-web commit -m test"',
        'sh -c "git -C tastile-web commit -m test"',
        'echo $(git -C tastile-web commit -m test)'
    )) {
        Clear-Logs
        $result = Invoke-Engine $unsafeShell
        Assert-True ($result.ExitCode -ne 0) "Only one simple direct git commit command is allowed: $unsafeShell"
        Assert-True (-not (Test-Path $gitLog) -and -not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Compound/wrapped commit must stop before processes"
    }

    foreach ($gitEnvironment in @(
        "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_EXTERNAL_DIFF",
        "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM", "GIT_ATTR_NOSYSTEM"
    )) {
        Clear-Logs
        [Environment]::SetEnvironmentVariable($gitEnvironment, "evil", "Process")
        $result = Invoke-Engine "git -C tastile-web commit -m test"
        [Environment]::SetEnvironmentVariable($gitEnvironment, $null, "Process")
        Assert-True ($result.ExitCode -ne 0) "Target-altering Git environment must fail closed: $gitEnvironment"
        Assert-True (-not (Test-Path $gitLog) -and -not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Git environment rejection must precede processes"
    }

    foreach ($unsafeGlobal in @(
        "git --git-dir fake -C tastile-web commit -m test",
        "git --work-tree fake -C tastile-web commit -m test",
        "git --namespace fake -C tastile-web commit -m test",
        "git --bare -C tastile-web commit -m test",
        "git -c core.worktree=fake -C tastile-web commit -m test",
        "git --config-env=core.worktree=FAKE_WORKTREE -C tastile-web commit -m test"
    )) {
        Clear-Logs
        $result = Invoke-Engine $unsafeGlobal
        Assert-True ($result.ExitCode -ne 0) "Target-altering Git global options must fail closed: $unsafeGlobal"
        Assert-True (-not (Test-Path $gitLog) -and -not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Unsafe global option must stop before Git, gate, and reviewer"
    }

    Clear-Logs
    $testGitCommand = $env:AGENT_LOOP_GIT_COMMAND
    Remove-Item Env:AGENT_LOOP_GIT_COMMAND
    $result = Invoke-Engine "git -C tastile-web commit -m test" -TestMode $false
    Assert-True ($result.ExitCode -ne 0 -and $result.Output.Contains("AGENT_LOOP_REVIEWER_COMMAND")) "Inherited reviewer override must be rejected outside test mode"
    Assert-True (-not (Test-Path $reviewLog)) "Production mode must not invoke an inherited reviewer override"
    $env:AGENT_LOOP_GIT_COMMAND = $testGitCommand

    Clear-Logs
    $testReviewerCommand = $env:AGENT_LOOP_REVIEWER_COMMAND
    Remove-Item Env:AGENT_LOOP_REVIEWER_COMMAND
    $result = Invoke-Engine "git -C tastile-web commit -m test" -TestMode $false
    Assert-True ($result.ExitCode -ne 0 -and $result.Output.Contains("AGENT_LOOP_GIT_COMMAND")) "Inherited Git override must be rejected outside test mode"
    Assert-True (-not (Test-Path $gitLog) -and -not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Production Git override rejection must happen before any process"
    $env:AGENT_LOOP_REVIEWER_COMMAND = $testReviewerCommand

    foreach ($repository in $repositories) {
        Clear-Logs
        $env:FAKE_GIT_PATCH = "diff --git a/file b/file +$repository"
        $result = Invoke-Engine "git -C $repository commit -m test"
        Assert-True ($result.ExitCode -eq 0) "$repository must route and approve: $($result.Output)"
        Assert-True (-not (Get-Content -Raw $gateLog).Contains((Join-Path $workspace $repository))) "$repository gate must run in an isolated snapshot"
        Assert-True ((Get-Content -Raw $promptLog).Contains("snapshot-skill")) "$repository skill was not loaded from the snapshot"
        Assert-True (-not (Get-Content -Raw $promptLog).Contains("unstaged-skill")) "$repository unstaged skill must not leak into review"
        if ($repository -eq "tastile-web") {
            Assert-True ((Get-Content -Raw $gateLog).Contains("--prepare")) "Web dependencies must be prepared inside the isolated snapshot"
        }
    }
    Assert-True ((Get-Content -Raw $gitLog).Contains("rev-parse --show-toplevel")) "Engine must resolve Git top-level before diff"
    Assert-True ((Get-Content -Raw $gitLog).Contains("rev-parse --git-dir")) "Engine must verify the canonical .git boundary before diff"
    Assert-True ((Get-Content -Raw $gitLog).Contains("diff --no-ext-diff --no-textconv --cached --binary --")) "Normal commit must disable external diff/textconv and capture the staged patch"
    Assert-True ((Get-Content -Raw $reviewLog).Trim() -eq "claude") "Claude caller must select Claude reviewer"

    foreach ($unsupported in @(
        "git -C tastile-web commit src/file.ts",
        "git -C tastile-web commit -- src/file.ts",
        "git -C tastile-web commit --only src/file.ts",
        "git -C tastile-web commit -o src/file.ts",
        "git -C tastile-web commit --include src/file.ts",
        "git -C tastile-web commit -i src/file.ts",
        "git -C tastile-web commit --status src/file.ts",
        "git -C tastile-web commit -S src/file.ts",
        "git -C tastile-web commit --amend -m test"
    )) {
        Clear-Logs
        $result = Invoke-Engine $unsupported
        Assert-True ($result.ExitCode -ne 0) "Pathspec, --only, and --include commit forms must fail closed: $unsupported"
        Assert-True (-not (Test-Path $gateLog) -and -not (Test-Path $reviewLog)) "Unsupported commit form must stop before gate and review"
    }

    foreach ($supported in @(
        'git -C tastile-web commit -m "src/file.ts"',
        'git -C tastile-web commit --author "Tastile Bot <bot@example.test>" -m test',
        'git -C tastile-web commit --template .gitmessage -m test'
    )) {
        Clear-Logs
        $env:FAKE_GIT_PATCH = "diff --git a/file b/file +flags-$([guid]::NewGuid())"
        $result = Invoke-Engine $supported
        Assert-True ($result.ExitCode -eq 0) "Message and option values must not be mistaken for pathspecs: $supported"
    }

    Clear-Logs
    $env:FAKE_GATE_EXIT = "17"
    $result = Invoke-Engine "git -C tastile-web commit -m test"
    Assert-True ($result.ExitCode -ne 0) "Failed gate must block"
    Assert-True (-not (Test-Path $reviewLog)) "Reviewer must not run after a failed gate"
    $env:FAKE_GATE_EXIT = "0"

    foreach ($badOutput in @("", "not-json", '{"verdict":"block","summary":"bug","findings":[{"severity":"important","file":"x","line":1,"message":"broken"}]}')) {
        Clear-Logs
        $env:FAKE_GIT_PATCH = "diff --git a/file b/file +bad-$([guid]::NewGuid())"
        $env:FAKE_REVIEW_OUTPUT = $badOutput
        $result = Invoke-Engine "git -C tastile-core commit -m test"
        Assert-True ($result.ExitCode -ne 0) "Missing, malformed, and block reviewer output must fail closed"
    }

    Clear-Logs
    $env:FAKE_REVIEW_OUTPUT = '{"verdict":"approve","summary":"safe","findings":[]}'
    $env:FAKE_GIT_PATCH = "diff --git a/file b/file +approved"
    $result = Invoke-Engine "git -C tastile-web commit -m test" -Caller "codex"
    Assert-True ($result.ExitCode -eq 0) "Valid approval must pass"
    Assert-True ((Get-Content -Raw $reviewLog).Trim() -eq "claude") "Codex caller must select Claude reviewer"

    Clear-Logs
    $env:FAKE_GIT_PATCH = "diff --git a/file b/file +mandatory-review"
    $first = Invoke-Engine "git -C tastile-android commit -m first" -Caller "opencode"
    $second = Invoke-Engine "git -C tastile-android commit -m second" -Caller "opencode"
    Assert-True ($first.ExitCode -eq 0 -and $second.ExitCode -eq 0) "Repeated exact diff can be approved"
    Assert-True (@(Get-Content $reviewLog).Count -eq 2) "Mandatory review must run for every commit attempt"
    Assert-True (@(Get-Content $reviewLog | Where-Object { $_.Trim() -eq "claude" }).Count -eq 2) "OpenCode caller must select Claude reviewer"

    Clear-Logs
    $env:FAKE_GIT_PATCH = "diff --git a/content.txt b/content.txt +broken-staged"
    $env:FAKE_STAGED_CONTENT = "broken-staged"
    $env:FAKE_GATE_REJECT_CONTENT = "broken-staged"
    $result = Invoke-Engine "git -C tastile-web commit -m snapshot-test"
    Assert-True ($result.ExitCode -ne 0) "Gate must see and reject staged snapshot content"
    Assert-True ((Get-Content -Raw $gateLog).Contains("broken-staged")) "Gate did not inspect staged snapshot content"
    Assert-True (-not (Get-Content -Raw $gateLog).Contains((Join-Path $workspace "tastile-web"))) "Gate ran against dirty source worktree"
    Assert-True (-not (Test-Path $reviewLog)) "Reviewer must not run when snapshot gate fails"
    $env:FAKE_STAGED_CONTENT = "staged-content"
    $env:FAKE_GATE_REJECT_CONTENT = "never-reject"

    Clear-Logs
    $env:FAKE_GIT_PATCH = "diff --git a/file b/file +tracked"
    $result = Invoke-Engine "git -C tastile-desktop commit -a -m test"
    Assert-True ($result.ExitCode -eq 0) "commit -a must be reviewable"
    Assert-True ((Get-Content -Raw $gitLog).Contains("diff --no-ext-diff --no-textconv HEAD --binary -- .")) "commit -a must disable external diff/textconv and capture tracked HEAD diff"
} finally {
    Get-ChildItem Env:AGENT_LOOP_*, Env:FAKE_* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

Write-Output "Invoke-PreCommitReview.ps1 tests passed"
