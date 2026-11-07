#!/usr/bin/env bash
# Project-only environment: never invoke or configure the system Pi CLI.
set -euo pipefail
harness_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$harness_root"
mode="${1:-help}"
if (( $# )); then shift; fi
case "$mode" in
    install) command=(npm ci --no-audit --no-fund) ;;
    check) command=(npm run check) ;;
    probe) command=(node scripts/qwen-preflight.js) ;;
    run)
        for flag in --host --port --mc-version --name --objective; do
            found=false
            for arg in "$@"; do
                if [[ "$arg" == "$flag" || "$arg" == "$flag="* ]]; then found=true; fi
            done
            if ! "$found"; then
                echo "Supply $flag explicitly; this launcher has no default game destination or identity." >&2
                exit 2
            fi
        done
        command=(node bin/minecraft-agent.js run "$@"
            --model corsair/qwen3.8-flash-next-bartowski-iq4_xs
            --models-file "$harness_root/.agent-state/local/models.json"
            --state-dir "$harness_root/.agent-state/game"
            --thinking medium --sandbox docker)
        command+=(--pi-extension "$harness_root/extensions/strata-budget.js")
        ;;
    *)
        echo 'Usage: bash scripts/local-harness.sh install|check|probe'
        echo 'Game launch (only after arranging the identity/server):'
        echo '  bash scripts/local-harness.sh run --host HOST --port PORT --mc-version VERSION --name NAME --objective "TASK" [flags]'
        exit 0
        ;;
esac
# Do not inherit cloud credentials, model overrides, or another Pi configuration.
# HOME still identifies the real user; Pi uses the explicit directory below.
exec env -i HOME="$HOME" PATH="$PATH" USER="${USER:-emma}" LANG="${LANG:-C.UTF-8}" \
    PI_CODING_AGENT_DIR="$harness_root/.agent-state/pi-config" PI_OFFLINE=1 \
    "${command[@]}"
