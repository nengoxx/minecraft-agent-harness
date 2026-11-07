import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPiSession } from '../src/model/session.js';
import { checkModel } from '../src/startup.js';

const root = resolve('.agent-state');
assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, 'pi-config'), 'Use scripts/local-harness.sh probe');
const modelsPath = join(root, 'local/models.json');
const model = { provider: 'corsair', id: 'qwen3.8-flash-next-bartowski-iq4_xs' };
assert.equal(await checkModel({ model, modelsPath }), null);
const runDir = join(root, 'preflight', new Date().toISOString().replaceAll(':', '-'));
await mkdir(runDir, { recursive: true, mode: 0o700 });
const token = randomUUID();
const calls = [];
const requests = [];
const events = {};
const options = {
    agentId: 'ProtocolProbe',
    cwd: runDir,
    sessionDir: join(runDir, 'sessions'),
    modelsPath,
    model,
    thinkingLevel: 'medium',
    piExtensions: [resolve('extensions/strata-budget.js')],
    systemPrompt:
        'You are testing a synthetic tool protocol. There is no Minecraft connection. Follow the test request exactly.',
    tools: [
        {
            name: 'echo_probe',
            label: 'echo_probe',
            description: 'Synthetic echo. First call returns a temporary failure; retry once with identical arguments.',
            parameters: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
            execute: async (_id, args) => {
                assert.equal(args.token, token);
                assert.ok(calls.length < 2, 'Unexpected extra tool call');
                calls.push(args);
                return {
                    isError: calls.length === 1,
                    content: [
                        {
                            type: 'text',
                            text:
                                calls.length === 1
                                    ? 'Synthetic temporary failure. Retry once.'
                                    : `Confirmed token: ${token}`,
                        },
                    ],
                    details: {},
                };
            },
        },
    ],
};
let session;
const watch = current => {
    const originalPayload = current.agent.onPayload?.bind(current.agent);
    current.agent.onPayload = async (payload, model) => {
        payload = (await originalPayload?.(payload, model)) ?? payload;
        assert.ok(requests.length < 6, 'Preflight request limit exceeded');
        assert.equal(payload.model, model.id);
        assert.equal(payload.max_tokens, 8192);
        assert.equal(payload.reasoning_effort, 'medium');
        assert.equal(payload.reasoning_budget_tokens, 2048);
        assert.equal(payload.stream, true);
        requests.push({
            model: payload.model,
            max_tokens: payload.max_tokens,
            reasoning_effort: payload.reasoning_effort,
            reasoning_budget_tokens: payload.reasoning_budget_tokens ?? null,
            stream: payload.stream,
            roles: payload.messages.map(message => message.role),
            toolResults: payload.messages.filter(message => message.role === 'tool').map(message => message.content),
        });
        return payload;
    };
    current.subscribe(event => {
        events[event.type] = (events[event.type] ?? 0) + 1;
        if (event.type === 'message_update')
            events[event.assistantMessageEvent.type] = (events[event.assistantMessageEvent.type] ?? 0) + 1;
    });
};
const deadline = setTimeout(() => {
    void session?.abort();
}, 90000);
const started = Date.now();
try {
    ({ session } = await createPiSession(options));
    watch(session);
    await session.prompt(
        `Call echo_probe with token "${token}". If it returns a temporary failure, retry exactly once with the same token. Then report the confirmed token.`,
    );
    assert.equal(calls.length, 2, 'Tool failure/retry round trip did not complete');
    assert.ok(
        requests.some(request =>
            request.toolResults.some(result => JSON.stringify(result).includes('Confirmed token')),
        ),
    );
    assert.ok(events.text_delta > 0, 'No streamed text');
    assert.ok(events.toolcall_delta > 0, 'No streamed tool call');
    const sessionFile = session.sessionManager.getSessionFile();
    session.dispose();
    ({ session } = await createPiSession(options));
    assert.equal(session.sessionManager.getSessionFile(), sessionFile, 'Session was not resumed');
    watch(session);
    await session.prompt('Without calling tools again, repeat the confirmed token from the earlier tool result.');
    const last = session.agent.state.messages.at(-1);
    assert.equal(last.role, 'assistant');
    assert.equal(last.stopReason, 'stop');
    assert.ok(
        last.content.some(part => part.type === 'text' && part.text.includes(token)),
        'Resumed session did not recall tool result',
    );
    const report = { passed: true, elapsedMs: Date.now() - started, calls, requests, events, sessionFile };
    await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(
        `Qwen streaming, structured tools, tool error/retry and session resume passed (${requests.length} model calls).`,
    );
    console.log(`Evidence: ${runDir}`);
    console.log('Wire settings: medium reasoning, max_tokens 8192, explicit reasoning_budget_tokens 2048.');
} catch (error) {
    await writeFile(
        join(runDir, 'report.json'),
        JSON.stringify(
            { passed: false, elapsedMs: Date.now() - started, error: error.message, calls, requests, events },
            null,
            2,
        ) + '\n',
    );
    throw error;
} finally {
    clearTimeout(deadline);
    session?.dispose();
}
