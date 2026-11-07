# Isolated local Qwen setup

This fork evaluates local Qwen through Strata. Mineflayer performs game actions;
the project-local Pi SDK maintains the model session. The installed system Pi CLI
and its normal coding configuration are not used. Start through
`scripts/local-harness.sh`, which scopes Pi state and clears inherited overrides.

Use Node >=22.19 and a working Docker daemon. Install only this checkout's locked
dependencies:

```sh
bash scripts/local-harness.sh install
bash scripts/local-harness.sh check
```

Create `.agent-state/local/models.json` (ignored by Git), replacing the host:

```json
{
  "providers": {
    "corsair": {
      "baseUrl": "http://YOUR-STRATA-HOST:18081/v1",
      "api": "openai-completions",
      "apiKey": "local-no-auth",
      "models": [
        {
          "id": "qwen3.8-flash-next-bartowski-iq4_xs",
          "name": "Corsair Qwen (local)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 262144,
          "maxTokens": 8192,
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false,
            "supportsReasoningEffort": true,
            "supportsStrictMode": false,
            "maxTokensField": "max_tokens"
          }
        }
      ]
    }
  }
}
```

The placeholder key is appropriate only for the existing unauthenticated local
backend. Configure your actual key there if the endpoint requires authentication.
The launcher and probe pin this provider/model ID. Change both when intentionally
choosing a different model; avoid environment-based silent fallbacks.

```sh
bash scripts/local-harness.sh probe
```

This synthetic model test exercises streaming, tools, retry and session replay
without joining Minecraft. Medium reasoning and `max_tokens: 8192` are sent to Strata. The launcher now loads
`extensions/strata-budget.js`, using Pi's standard `before_provider_request` hook
to add `reasoning_budget_tokens: 2048`. This matches Mindcraft's explicit request.
A medium-only live request continued reasoning for 140 seconds without a tool
call; replaying the captured payload with the explicit budget returned tool calls
in 74.75 seconds. These single runs are evidence for the configuration correction,
not a controlled benchmark or proof of task success.

After arranging exclusive ownership of the bot identity and a running server or
proxy, use explicit connection arguments, for example:

```sh
bash scripts/local-harness.sh run \
  --host 127.0.0.1 --port 25568 --mc-version 26.1 --name amaia \
  --objective 'Help the player with tasks requested in chat.' \
  --auto-defense --no-reconnect
```

This starts without a whole-process time limit. Stop with Ctrl+C, or explicitly
add `--duration MINUTES` when a bounded test is intended. T05's 15-minute stop was
an operator-selected launch flag, not a default turn limit or a daylight trigger.
For continuing task evaluation, record timed checkpoints without disconnecting
solely because a checkpoint is reached. Individual action deadlines still apply;
the model scheduler's 30-minute cycle watchdog schedules another cycle instead
of ending the process. Automatic defense is explicitly enabled in this example; see
[architecture](architecture.md#automatic-defense) for its scope and limits.
The longer qualification run uses `--duration 45` with progress checkpoints.

The current local server is 26.3, reached through a separate ViaProxy 3.4.14
process using client protocol 26.1. This launcher does not start or reconfigure
the server/proxy. See [compatibility baseline](DEPENDENCIES.md) for versions and
[trial methodology](EVALUATION.md) for the role of the operator versus Qwen.

One Docker container is reused per identity/state directory. The game connection
and logs run on the host; Qwen's shell runs inside the container. Persistent state
lives under `.agent-state/game/`, including Pi transcripts, telemetry, diagnostics,
mailbox and workspace notes. Keep that directory for continuity. No Compose stack,
extra Minecraft server container, global Pi installation or cloud model is needed.

Incoming player whispers enter the native mailbox and `send_dm` replies in game.
An initial CLI objective is a system instruction, not a player chat message.
Operator-injected trial messages are recorded separately from actual network chat.

## Explicit Pi extensions

Use repeatable `--pi-extension /absolute/path/to/extension.js`, or `piExtensions`
as an array in the JSON config. Pi loads only those explicit paths; global and
project auto-discovery remain disabled. A missing/invalid extension fails startup.
The extension's registered tools are available alongside game tools, without
activating Pi's built-in host shell/file tools. Extensions themselves execute in
the host SDK process, so load reviewed code appropriate for that trust boundary.

This uses the installed Pi SDK's resource loader and lifecycle, not a new plugin
system. The Strata extension changes only medium requests for the `corsair`
Chat Completions provider and preserves an already-explicit budget. Other
providers/reasoning levels are unchanged. The synthetic regression loads Pi's
unmodified upstream todo example as well, proving that existing extensions can
be used when needed. No planning/todo extension is enabled in live trials yet.

The standard Pi plan-mode example is a coding exploration/interactive approval
workflow. It does not solve a backend reasoning-budget mismatch, and its default
coding-tool workflow is not a suitable drop-in gameplay controller. The harness
already supplies persistent notes and `read_plan`/`append_plan` tools. Add further
planning machinery only after a repeatable failure demonstrates what is missing.
