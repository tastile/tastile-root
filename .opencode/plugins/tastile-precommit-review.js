export const TastilePreCommitReview = async ({ worktree }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return

    const hookInput = JSON.stringify({
      cwd: worktree,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: output.args,
    })
    const process = Bun.spawn({
      cmd: [
        "pwsh",
        "-NoProfile",
        "-File",
        `${worktree}/.agent-loop/Invoke-AgentHook.ps1`,
        "-Caller",
        "opencode",
      ],
      cwd: worktree,
      stdin: new Blob([hookInput]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    if (exitCode !== 0) {
      throw new Error(
        (stderr || stdout || "Tastile pre-commit review denied this command").trim(),
      )
    }
  },
})
