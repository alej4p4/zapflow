/**
 * Free LLM APIs Multi-Provider Router for ZapFlow (#C29 & #C30)
 * Powered by the Antigravity `free-llm-apis` plugin catalog:
 * - Groq (Llama 3.3 70B + Whisper Large V3 Turbo for audio transcription)
 * - Cerebras (Llama 3.3 70B ultra-fast)
 * - Google AI Studio / Gemini (Gemini 2.0 Flash)
 * - OpenRouter (:free models)
 * - Mistral La Plateforme (mistral-small-latest)
 * - GitHub Models (gpt-4o-mini)
 * - Local Ollama (http://localhost:11434/v1)
 */

export interface FreeLLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface CustomFreeLLMKeys {
    groqApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
    cerebrasApiKey?: string;
    mistralApiKey?: string;
    openaiApiKey?: string;
}

export interface FreeLLMProvider {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
    extraHeaders?: Record<string, string>;
}

export function getActiveFreeLLMProviders(customKeys?: CustomFreeLLMKeys): FreeLLMProvider[] {
    const groqKey = customKeys?.groqApiKey?.trim() || process.env.GROQ_API_KEY?.trim();
    const cerebrasKey = customKeys?.cerebrasApiKey?.trim() || process.env.CEREBRAS_API_KEY?.trim();
    const geminiKey = customKeys?.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
    const openrouterKey = customKeys?.openrouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
    const mistralKey = customKeys?.mistralApiKey?.trim() || process.env.MISTRAL_API_KEY?.trim();
    const githubKey = process.env.GITHUB_TOKEN?.trim();
    const sambanovaKey = process.env.SAMBANOVA_API_KEY?.trim();

    const candidates: FreeLLMProvider[] = [
        {
            id: "groq",
            name: "Groq (Llama 3.3 70B)",
            baseUrl: "https://api.groq.com/openai/v1",
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            apiKey: groqKey
        },
        {
            id: "cerebras",
            name: "Cerebras (Llama 3.3 70B)",
            baseUrl: "https://api.cerebras.ai/v1",
            model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
            apiKey: cerebrasKey
        },
        {
            id: "gemini",
            name: "Google Gemini 2.0 Flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
            apiKey: geminiKey
        },
        {
            id: "openrouter",
            name: "OpenRouter (:free)",
            baseUrl: "https://openrouter.ai/api/v1",
            model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
            apiKey: openrouterKey,
            extraHeaders: {
                "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
                "X-Title": "ZapFlow WhatsApp CRM"
            }
        },
        {
            id: "mistral",
            name: "Mistral Small",
            baseUrl: "https://api.mistral.ai/v1",
            model: process.env.MISTRAL_MODEL || "mistral-small-latest",
            apiKey: mistralKey
        },
        {
            id: "github",
            name: "GitHub Models (GPT-4o-mini)",
            baseUrl: "https://models.inference.ai.azure.com",
            model: process.env.GITHUB_MODEL || "gpt-4o-mini",
            apiKey: githubKey
        },
        {
            id: "sambanova",
            name: "SambaNova (Llama 3.3 70B)",
            baseUrl: "https://api.sambanova.ai/v1",
            model: process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct",
            apiKey: sambanovaKey
        }
    ];

    const active = candidates.filter(p => Boolean(p.apiKey && p.apiKey.length > 5));

    if (process.env.OLLAMA_ENABLED === "true" || process.env.OLLAMA_MODEL) {
        active.push({
            id: "ollama",
            name: "Ollama Local",
            baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
            model: process.env.OLLAMA_MODEL || "llama3.2",
            apiKey: "ollama"
        });
    }

    return active;
}

export async function callFreeLLMWithFallback(
    messages: FreeLLMMessage[],
    options?: {
        temperature?: number;
        maxTokens?: number;
        timeoutMs?: number;
        customKeys?: CustomFreeLLMKeys;
    }
): Promise<{ content: string; provider: string; model: string; isFallbackLocal?: boolean }> {
    const providers = getActiveFreeLLMProviders(options?.customKeys);

    for (const provider of providers) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 18000);

        try {
            const res = await fetch(`${provider.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${provider.apiKey}`,
                    ...(provider.extraHeaders || {})
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages,
                    temperature: options?.temperature ?? 0.65,
                    max_tokens: options?.maxTokens ?? 900
                }),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!res.ok) {
                continue;
            }

            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content?.trim();
            if (content) {
                return {
                    content,
                    provider: provider.name,
                    model: provider.model
                };
            }
        } catch {
            clearTimeout(timer);
        }
    }

    throw new Error("NO_ACTIVE_FREE_LLM_PROVIDER");
}
