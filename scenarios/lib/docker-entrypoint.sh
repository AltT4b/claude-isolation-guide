#!/usr/bin/env bash
set -e

case "${1:-test}" in
  test)
    npm test
    exit_code=$?
    echo ""
    echo "Tip: Run 'docker compose run --rm sandbox claude' to launch Claude Code interactively."
    exit $exit_code
    ;;
  claude)
    shift
    exec /usr/local/bin/claude "$@"
    ;;
  bash|shell|sh)
    echo "=== Interactive shell in hardened container ==="
    echo ""
    echo "Try these probes:"
    echo "  id                                          # who am I?"
    echo "  grep CapEff /proc/self/status               # capabilities"
    echo "  cat /sys/fs/cgroup/memory.max               # memory limit"
    echo "  touch /test-file                            # read-only root?"
    echo "  curl -sf --max-time 3 https://example.com   # network?"
    echo "  claude --version                            # CLI installed?"
    echo ""
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
