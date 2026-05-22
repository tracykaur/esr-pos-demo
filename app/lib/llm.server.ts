const PROXY_URL = process.env.AI_PROXY_URL || "https://proxy.shopify.ai";
const PROXY_TOKEN = process.env.AI_PROXY_TOKEN || "";

const MODELS = {
  fast: "anthropic:claude-haiku-4-5-20251001",
  standard: "anthropic:claude-sonnet-4-6",
} as const;

type ModelTier = keyof typeof MODELS;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function isLlmConfigured(): boolean {
  return Boolean(PROXY_TOKEN);
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: { model?: ModelTier; maxTokens?: number; temperature?: number } = {},
): Promise<{ content: string; model: string }> {
  const { model = "fast", maxTokens = 500, temperature = 0.2 } = options;
  if (!PROXY_TOKEN) throw new Error("AI proxy token is not configured.");

  const response = await fetch(`${PROXY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PROXY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS[model],
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model: data.model ?? MODELS[model],
  };
}
