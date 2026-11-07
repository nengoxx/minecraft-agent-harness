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
without joining Minecraft. Medium reasoning is sent to Strata, which Ari has
configured to map it to a 2048-token reasoning budget. Maximum output is 8192.
The probe verifies requests, not the backend's internal budget implementation.

After arranging exclusive ownership of the bot identity and a running server or
proxy, use explicit connection arguments, for example:

```sh
bash scripts/local-harness.sh run \
  --host 127.0.0.1 --port 25568 --mc-version 26.1 --name amaia \
  --objective 'Help the player with tasks requested in chat.' \
  --duration 12 --no-reconnect
```

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
