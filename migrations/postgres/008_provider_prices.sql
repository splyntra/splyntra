-- Seed representative per-1K token prices for the LLM providers surfaced in the
-- Connect catalog, so cost tracking is live out of the box. Prices are indicative
-- (USD, per 1K tokens) and fully editable in Settings → Pricing; ON CONFLICT keeps
-- any operator-customized rows. Cost lookup is model-name based and provider-agnostic.
INSERT INTO model_prices (model, prompt_per_1k, completion_per_1k) VALUES
    -- Google Gemini
    ('gemini-2.0-flash',        0.0001,  0.0004),
    ('gemini-2.5-flash',        0.00015, 0.0006),
    ('gemini-2.5-pro',          0.00125, 0.01),
    -- Groq (Llama)
    ('llama-3.3-70b-versatile', 0.00059, 0.00079),
    ('llama-3.1-8b-instant',    0.00005, 0.00008),
    -- DeepSeek
    ('deepseek-chat',           0.00027, 0.0011),
    ('deepseek-reasoner',       0.00055, 0.00219),
    -- Mistral
    ('mistral-medium',          0.0027,  0.0081),
    ('mistral-small-latest',    0.0002,  0.0006),
    -- Cohere
    ('command-r',               0.00015, 0.0006),
    ('command-r-plus',          0.0025,  0.01),
    -- xAI Grok
    ('grok-2',                  0.002,   0.01),
    ('grok-3',                  0.003,   0.015),
    -- Together / Fireworks (common open models)
    ('meta-llama/Llama-3.1-70B-Instruct', 0.0009, 0.0009),
    ('accounts/fireworks/models/llama-v3p1-70b-instruct', 0.0009, 0.0009)
ON CONFLICT (model) DO NOTHING;
