#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="claude-yolo"
# Pass a worktree path as $1, e.g.: ./claude-yolo.sh .worktrees/implement
# Defaults to the repo root (main branch).
WORK_DIR="${1:-$SCRIPT_DIR}"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"  # resolve to absolute path

# Always mount the repo root so git worktrees resolve correctly inside the container.
# Claude's working directory is set to the target path inside /workspace.
PROJECT_DIR="$SCRIPT_DIR"
CONTAINER_WORK_DIR="/workspace${WORK_DIR#$SCRIPT_DIR}"

if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
    echo "Building Claude YOLO container..."
    docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"
fi

# Forward host SSH agent into the container so `git push` and `gh` use the
# host's keys. On macOS Docker Desktop, the host agent is reachable inside
# the Linux VM only via the magic /run/host-services/ssh-auth.sock proxy;
# on Linux we forward the actual SSH_AUTH_SOCK.
SSH_FORWARD_ARGS=()
if [[ "$(uname -s)" == "Darwin" ]]; then
    SSH_FORWARD_ARGS=(-v "/run/host-services/ssh-auth.sock:/ssh-agent" -e SSH_AUTH_SOCK=/ssh-agent)
elif [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_FORWARD_ARGS=(-v "$SSH_AUTH_SOCK:/ssh-agent" -e SSH_AUTH_SOCK=/ssh-agent)
fi

docker run -it --rm \
    -v "$PROJECT_DIR:/workspace" \
    -v "$HOME/.claude:/home/node/.claude" \
    -w "$CONTAINER_WORK_DIR" \
    "${SSH_FORWARD_ARGS[@]}" \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    "$IMAGE_NAME" \
    --dangerously-skip-permissions
