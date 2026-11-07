import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMinecraftSession, createPiSession } from '../../src/model/session.js';
import strataBudget from '../../extensions/strata-budget.js';

const extension = resolve('extensions/strata-budget.js');

test('explicit Pi extensions reach the actual provider request without enabling host tools or discovery', async t => {
    const root = await mkdtemp(join(tmpdir(), 'harness-extensions-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, '.pi/extensions'), { recursive: true });
    await writeFile(
        join(root, '.pi/extensions/unwanted.js'),
        "throw new Error('Automatic discovery must remain disabled');",
    );
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            requests.push(JSON.parse(body));
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            for (const choice of [
                { delta: { role: 'assistant', content: 'Ready.' }, finish_reason: null },
                { delta: {}, finish_reason: 'stop' },
            ])
                res.write(
                    `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: 'test-qwen', choices: [{ index: 0, ...choice }] })}\n\n`,
                );
            res.end('data: [DONE]\n\n');
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const modelsPath = join(root, 'models.json');
    const provider = {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        api: 'openai-completions',
        apiKey: 'synthetic',
        models: [
            {
                id: 'test-qwen',
                reasoning: true,
                input: ['text'],
                contextWindow: 32768,
                maxTokens: 8192,
                compat: { supportsDeveloperRole: false, supportsReasoningEffort: true, maxTokensField: 'max_tokens' },
            },
        ],
    };
    await writeFile(modelsPath, JSON.stringify({ providers: { corsair: provider, unrelated: provider } }));
    for (const [index, providerName, paths, expectedBudget] of [
        [0, 'corsair', [], undefined],
        [
            1,
            'corsair',
            [extension, resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts')],
            2048,
        ],
        [2, 'unrelated', [extension], undefined],
    ]) {
        const cycles = [];
        const runner = await createMinecraftSession({
            agentId: `case${index}`,
            cwd: root,
            sessionDir: join(root, 'sessions'),
            modelsPath,
            model: { provider: providerName, id: 'test-qwen' },
            thinkingLevel: 'medium',
            systemPrompt: 'Synthetic test; no Minecraft connection.',
            tools: [],
            piExtensions: paths,
            observe: async () => ({ text: 'Synthetic observation' }),
            cycleTelemetry: event => cycles.push(event),
        });
        try {
            runner.start();
            const deadline = Date.now() + 5000;
            while (!cycles.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
            assert.equal(cycles[0]?.status, 'complete');
            const request = requests[index];
            assert.equal(request.reasoning_effort, 'medium');
            assert.equal(request.reasoning_budget_tokens, expectedBudget);
            const names = request.tools?.map(t => t.function.name) ?? [];
            assert.equal(names.includes('todo'), index === 1);
            for (const name of ['bash', 'read', 'write', 'edit']) assert.ok(!names.includes(name));
        } finally {
            await runner.close();
        }
    }
    await assert.rejects(
        createPiSession({
            agentId: 'missing',
            cwd: root,
            sessionDir: join(root, 'sessions'),
            modelsPath,
            model: { provider: 'corsair', id: 'test-qwen' },
            tools: [],
            piExtensions: [join(root, 'missing.js')],
        }),
        /Pi extension load failed/,
    );
});

test('Strata hook preserves explicit budgets and other reasoning levels without mutating input', () => {
    let hook;
    strataBudget({
        on: (name, handler) => {
            assert.equal(name, 'before_provider_request');
            hook = handler;
        },
    });
    const ctx = { model: { provider: 'corsair', api: 'openai-completions' } };
    for (const payload of [{ reasoning_effort: 'low' }, { reasoning_effort: 'medium', reasoning_budget_tokens: 500 }])
        assert.equal(hook({ payload }, ctx), undefined);
    const payload = { reasoning_effort: 'medium', max_tokens: 8192 };
    assert.deepEqual(hook({ payload }, ctx), { ...payload, reasoning_budget_tokens: 2048 });
    assert.equal(payload.reasoning_budget_tokens, undefined);
});
