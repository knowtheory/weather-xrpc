# Workcell Development Flow

How to develop `weather_xrpc` inside Workcell's bounded local runtime (Colima
VM + hardened container) with Claude Code as the agent.

## Frictions specific to this repo

- `better-sqlite3` is a native module. The `node_modules` built on macOS will
  not load inside the Linux container — rebuild on first launch with `npm ci`.
- The repo's `.claude/settings.json` and `CLAUDE.md` are *masked* on the safe
  path and re-imported as reviewed inputs. They do not silently rewrite the
  container's control plane.
- `claude-yolo.sh` in this repo bind-mounts `~/.claude`, forwards
  `SSH_AUTH_SOCK`, and passes `ANTHROPIC_API_KEY` through. That is the
  trust-widening pattern Workcell exists to replace — do not mix the two.
- `--mode development` is required for this stack (npm install / native
  rebuilds). `strict` would block them.
- `publish-pr` requires signed commits and `main`-base PRs by default.

## One-time host setup

```bash
# Install Workcell if needed
cd /Users/ted/Projects/workcell && ./scripts/install.sh

# Stake the Claude API key (owner-only)
mkdir -p ~/.config/workcell
umask 077 && printf '%s\n' "$ANTHROPIC_API_KEY" > ~/.config/workcell/claude-api-key.txt

# Initialize the injection policy and bind the credential
workcell auth init
workcell auth set --agent claude \
    --credential claude_api_key \
    --source ~/.config/workcell/claude-api-key.txt

# Confirm host-side view
workcell auth status --agent claude
workcell policy validate
```

## Pre-flight (no launch)

```bash
REPO=/Users/ted/Projects/hanger/squibs/weather_xrpc
workcell --agent claude --doctor      --workspace "$REPO"
workcell --agent claude --inspect     --workspace "$REPO"
workcell --agent claude --auth-status --workspace "$REPO"
```

Read the `bootstrap_*` / `provider_bootstrap_*` lines to confirm the staged
auth is launch-ready.

## Daily working loop (interactive)

```bash
REPO=/Users/ted/Projects/hanger/squibs/weather_xrpc

workcell --agent claude \
    --mode development \
    --cache-profile standard \
    --workspace "$REPO"
```

Default autonomy is `yolo`, which the wrapper translates to
`--permission-mode bypassPermissions` inside the container — the same posture
as `claude-yolo.sh`, but the sandbox (cap-drop ALL, allowlist network,
ephemeral rootfs, masked control plane) is the safety boundary instead of
host trust.

Inside the session, the first time (or after any dependency change):

```bash
rm -rf node_modules        # host-built binaries are wrong for Linux
npm ci                     # rebuilds better-sqlite3 for the container
npm test
npm run dev
```

`--cache-profile standard` keeps npm cache and workspace-scoped build
artifacts warm across launches. It is a labeled lower-assurance choice; keep
it for dev, drop it for review-only sessions.

### Mode by work type

| Work type            | Launch command                                                                                       |
|----------------------|------------------------------------------------------------------------------------------------------|
| Feature development  | default daily-loop command above                                                                     |
| Refactor / cleanup   | same as default; consider dropping `--cache-profile standard`                                        |
| Bug investigation    | same as default; `vitest --watch` inside the session                                                 |
| Code review / audit  | drop `--mode development` — launch plain `strict` so no install path exists                          |
| Subagent dispatch    | `./scripts/dispatch-subagent.sh "<prompt>"` (see next section)                                       |

## Subagent dispatch (headless one-shot)

To delegate a task to a fresh, sandboxed Claude run from a host script or a
parent agent — no TTY, no shared `~/.claude`, no API key in env:

```bash
./scripts/dispatch-subagent.sh "<prompt>"               # JSON on stdout
./scripts/dispatch-subagent.sh --text "<prompt>"        # just the .result text
./scripts/dispatch-subagent.sh -f stream-json "<prompt>" # per-turn line-delimited JSON
./scripts/dispatch-subagent.sh -m development "<prompt>" # if the subagent needs npm/lifecycle commands
```

The wrapper is a thin shell around:

```bash
workcell --agent claude --workspace "$REPO" \
    -- -p "<prompt>" --output-format json 2>/dev/null
```

Everything after `--` is forwarded to `claude` inside the container.
`reject_unsafe_claude_args` (`runtime/container/provider-policy.sh`) blocks
the host-trust escapes (`--dangerously-skip-permissions`, `--permission-mode`,
`--mcp-config`, `--settings`, `--system-prompt`, `--add-dir`, …) but lets
`-p`, `--output-format`, `--input-format`, `--model`, `--resume`, and
`--verbose` through. `-it` is added to the underlying `docker run` only when
both stdin and stdout are TTYs (`scripts/workcell` ~9079), so piping stdout
into `jq` automatically yields a non-interactive container — no extra flag
needed.

### Response shape

`--output-format json` returns one object: the final answer in `result`,
plus session metadata. **Tool use is not in this object** — token counts
and `num_turns` reflect that the agent used tools internally.

```json
{
  "type": "result", "subtype": "success", "is_error": false,
  "result": "weather-xrpc@0.1.0",
  "session_id": "1ca0566a-…", "num_turns": 2,
  "duration_ms": 4189, "stop_reason": "end_turn",
  "total_cost_usd": 0.0329,
  "usage":      { "input_tokens": 4, "output_tokens": 106, "cache_read_input_tokens": 27436, … },
  "modelUsage": { "claude-sonnet-4-6": { … }, "claude-haiku-4-5-…": { … } }
}
```

For per-turn visibility (tool calls, tool results, intermediate assistant
messages), use `--output-format stream-json --verbose`. Each line is a
distinct JSON object; observed line types in order:
`system/init`, `assistant`, `user` (tool result), `assistant`, …, `result/success`.
The `result/success` line carries the same shape as `--output-format json`.

### Latency

On a warm Colima VM, end-to-end overhead per call is **~30–40 s** before the
agent runs (≈15 s for managed Colima profile reconcile, then container
create + claude startup). Plan dispatch costs accordingly — chunky tasks
beat lots of tiny ones, and a parent agent should batch related questions
into one prompt rather than fan out trivially.

### What does not work today

- `--resume <session_id>` against a session from a previous invocation. The
  ephemeral `/state/agent-home` is wiped at container exit, so the
  conversation file is gone. Error: `No conversation found with session ID: …`.
  Multi-turn across calls requires `workcell session start` + `session send`
  (interactive attach loop), not one-shot mode.
- Concurrent one-shots writing to the same workspace will collide — they all
  bind-mount `$REPO` at `/workspace` read-write. For parallel subagents, use
  per-worktree `--workspace .worktrees/agent-N` or
  `session start --session-workspace isolated`.

### Mode and assurance

Default `--mode strict` blocks lifecycle commands (`install`, `update`, etc.).
For subagents that need to run tests or rebuild native modules, add
`--mode development` — same trade-off as for interactive sessions.

## Publish back to GitHub (host-side)

After committing work on a feature branch *inside* the session, exit Claude
and run on the host:

```bash
cd "$REPO"
git log --oneline origin/main..HEAD     # sanity-check the range
gpg --list-secret-keys                  # confirm a signing key is available

workcell publish-pr \
    --workspace "$REPO" \
    --branch feature/<name> \
    --title-file /tmp/pr-title.txt \
    --body-file /tmp/pr-body.md \
    --commit-message-file /tmp/commit-message.txt
```

`publish-pr` fails closed on unsigned commits and on overly broad branch
diffs. Fix signing globally rather than working around it.

## Session bookkeeping

```bash
workcell session list                       # all recorded launches
workcell session show --id <id> --text      # stable key=value summary
workcell session diff --id <id>             # workspace delta vs clean base
workcell --gc                               # clean stale scratch / cache
```

`session diff` is the cleanest review of what an autonomous run changed.

## Open decisions

1. **MCP servers**: default is empty inside the sandbox. To enable any, stage
   them via `workcell auth set --agent claude --credential claude_mcp
   --source <file>`.
2. **Repo `CLAUDE.md`**: remove any host-assumption language (e.g. references
   to `claude-yolo.sh` paths) so the rendered instructions inside the sandbox
   stay accurate.
3. **Detached sessions**: `workcell session start/attach/send/stop` ship
   today and back long-lived flows. One-shot subagent dispatch (see above)
   does not need them. Multi-turn subagent dispatch *across* invocations is
   still open — it needs prompt injection at `session start` and a structured
   result-return path; until then, multi-turn lives in the interactive
   attach/send loop.
4. **Retire `claude-yolo.sh`**: with interactive yolo (`--mode development`)
   and one-shot subagent dispatch both working through workcell, the script
   no longer covers anything workcell does not. Outstanding gating items
   before deletion: (a) confirm no scripts or muscle-memory invocations
   depend on its `~/.claude` bind-mount or SSH-agent forwarding, (b) workcell
   session metadata is being kept rather than discarded after each run
   (audit log lives at `~/.local/state/workcell/.../workcell.audit.log`).
   The subagent-dispatch wrapper at `scripts/dispatch-subagent.sh` covers
   the headless one-shot path that `claude-yolo.sh` never had a clean answer
   for.
