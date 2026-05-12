#!/usr/bin/env bash
# Dispatch a one-shot Claude subagent inside a workcell sandbox.
#
# Emits the workcell + claude exit code. By default, prints one JSON result
# object on stdout (the shape documented in workcell.md). Workcell metadata
# stays on stderr.
#
# Usage:
#   dispatch-subagent.sh [options] [--] <prompt>
#   dispatch-subagent.sh [options] <<< "<prompt>"
#   echo "<prompt>" | dispatch-subagent.sh [options]

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: dispatch-subagent.sh [options] [--] <prompt>

Options:
  -w, --workspace PATH   Repo root to mount as /workspace (default: git toplevel of cwd)
  -m, --mode MODE        strict | development (default: strict; use development for npm/lifecycle commands)
  -f, --format FORMAT    json | stream-json | text (default: json)
  -t, --text             Extract just the .result text from JSON output (implies --format json, requires jq)
      --model NAME       Claude model id (e.g. claude-sonnet-4-6)
  -h, --help             Show this help

The prompt may be given as positional arguments, or piped on stdin if no
positional prompt is provided. See workcell.md ("Subagent dispatch") for the
expected output shape and the limits (~30-40s warm overhead, no --resume
across calls, workspace bind-mount is read-write).
EOF
}

WORKSPACE=""
MODE="strict"
FORMAT="json"
TEXT_ONLY=0
MODEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -w|--workspace) WORKSPACE="$2"; shift 2 ;;
    -m|--mode)      MODE="$2"; shift 2 ;;
    -f|--format)    FORMAT="$2"; shift 2 ;;
    -t|--text)      TEXT_ONLY=1; shift ;;
    --model)        MODEL="$2"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    --)             shift; break ;;
    -*)             echo "error: unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *)              break ;;
  esac
done

if [[ $# -gt 0 ]]; then
  PROMPT="$*"
elif [[ ! -t 0 ]]; then
  PROMPT="$(cat)"
else
  echo "error: no prompt given (positional args or stdin)" >&2
  usage >&2
  exit 2
fi

if [[ -z "${PROMPT//[[:space:]]/}" ]]; then
  echo "error: empty prompt" >&2
  exit 2
fi

if [[ -z "$WORKSPACE" ]]; then
  WORKSPACE="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
if [[ ! -d "$WORKSPACE" ]]; then
  echo "error: workspace not a directory: $WORKSPACE" >&2
  exit 2
fi

case "$FORMAT" in
  json|stream-json|text) ;;
  *) echo "error: unknown --format: $FORMAT (want json|stream-json|text)" >&2; exit 2 ;;
esac

if [[ "$TEXT_ONLY" -eq 1 && "$FORMAT" != "json" ]]; then
  echo "error: --text requires --format json" >&2
  exit 2
fi

command -v workcell >/dev/null 2>&1 || {
  echo "error: 'workcell' not on PATH (see workcell.md 'One-time host setup')" >&2
  exit 2
}

CLAUDE_ARGS=(-p "$PROMPT" --output-format "$FORMAT")
[[ "$FORMAT" == "stream-json" ]] && CLAUDE_ARGS+=(--verbose)
[[ -n "$MODEL" ]] && CLAUDE_ARGS+=(--model "$MODEL")

WORKCELL_CMD=(workcell --agent claude --mode "$MODE" --workspace "$WORKSPACE" -- "${CLAUDE_ARGS[@]}")

if [[ "$TEXT_ONLY" -eq 1 ]]; then
  command -v jq >/dev/null 2>&1 || {
    echo "error: 'jq' required for --text" >&2
    exit 2
  }
  out="$("${WORKCELL_CMD[@]}")"
  printf '%s' "$out" | jq -r '.result'
else
  exec "${WORKCELL_CMD[@]}"
fi
