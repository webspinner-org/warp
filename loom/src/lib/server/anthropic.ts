import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic BYOK client wrapper for the bootstrap Weaver.
 *
 * Per `DECISIONS.md` 2026-05-10 — *Mission-locked Weaver system prompt* —
 * every model call carries the Spinner's mission lock as the system
 * prompt. The Weaver assembles `system` from the mission lock plus the
 * grounding from declared Spools, then calls the model with the
 * Webspinner's input as the user message.
 *
 * Bootstrap exception (`DECISIONS.md` 2026-05-10 — *Bootstrap Weaver
 * runs inside the Loom*): the canonical Weaver lives in Python+FastAPI;
 * this client is a temporary in-Loom shim that supersedes when the
 * canonical Weaver lands. The shape of the call — system + messages —
 * matches what LiteLLM presents in the canonical version.
 */
export interface ModelCallInput {
  readonly model: string;
  readonly system: string;
  readonly userMessage: string;
  readonly maxTokens?: number;
}

export interface ModelCallOutput {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: string;
}

export class AnthropicCallError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AnthropicCallError';
  }
}

export async function callAnthropic(
  apiKey: string,
  input: ModelCallInput,
): Promise<ModelCallOutput> {
  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      system: input.system,
      messages: [{ role: 'user', content: input.userMessage }],
    });
  } catch (e) {
    throw new AnthropicCallError(
      `Anthropic API call failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }

  const text = response.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason ?? 'unknown',
  };
}

/**
 * Resolve a Spinner manifest's `model` field (e.g. `anthropic/claude-opus-4-7`)
 * to a concrete Anthropic model id. Returns null when the provider is
 * not Anthropic — the canonical Weaver will route through LiteLLM by
 * provider; this shim handles only Anthropic.
 */
export function resolveAnthropicModel(manifestModel: string | undefined): string | null {
  if (!manifestModel) return 'claude-opus-4-7';
  const parts = manifestModel.split('/');
  if (parts.length !== 2) return null;
  const [provider, model] = parts as [string, string];
  if (provider !== 'anthropic') return null;
  return model;
}
