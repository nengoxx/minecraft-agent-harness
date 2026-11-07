// Pi's standard request hook; only the explicitly configured local provider.
export default function strataBudget(pi) {
    pi.on('before_provider_request', (event, ctx) => {
        if (ctx.model?.provider !== 'corsair' || ctx.model.api !== 'openai-completions') return;
        const payload = event.payload;
        if (payload.reasoning_effort !== 'medium' || payload.reasoning_budget_tokens != null) return;
        return { ...payload, reasoning_budget_tokens: 2048 };
    });
}
