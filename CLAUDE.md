# weather-xrpc

## GitHub access (workcell / container environments)

When running inside a workcell container, SSH access to GitHub is not available. Before pushing, switch the remote to HTTPS:

```bash
git remote set-url origin https://github.com/knowtheory/weather-xrpc.git
gh auth setup-git
```

Then push and create PRs normally with `git push` and `gh pr create`.

## Git in workcell containers

Workcell's git shim blocks commands when `GIT_EDITOR`, `EDITOR`, `PAGER`, and related vars are set. A clean wrapper is injected at `/usr/local/bin/git` — if git still fails with "blocked control-plane override", define this function once at the start of the session:

```bash
git() { env -u GIT_EDITOR -u EDITOR -u PAGER -u VISUAL -u GIT_SSH -u GIT_SSH_COMMAND -u GIT_ASKPASS -u SSH_ASKPASS -u GIT_SEQUENCE_EDITOR -u GIT_PAGER command git "$@"; }
```
