#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="claude-yolo"
PROJECT_DIR="${1:-$SCRIPT_DIR}"

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
    "${SSH_FORWARD_ARGS[@]}" \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    "$IMAGE_NAME" \
    --dangerously-skip-permissions
