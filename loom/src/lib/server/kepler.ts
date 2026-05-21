// Kepler-loopback clients — embeddings sidecar and the Quiet Loom (generation).
//
// Per `~/webspinner-work/POLICY-PATRON-PATH-LLM.md` (ratified 2026-05-03)
// and Warp canon §11 (Pledge), patron-path generation and embeddings are
// sovereign — served by the Kepler-resident services on loopback. External
// providers (Anthropic, OpenAI) are PROHIBITED on the patron path; they
// remain available only as a *backstop* for the engine Worker, gated and
// metered. The Bootstrap Spinner today routes to the embeddings sidecar + the Quiet Loom
// directly; no Anthropic on this path.

const EMBEDDINGS_URL = process.env['WARP_EMBEDDINGS_URL'] ?? 'http://127.0.0.1:11446';
const QUIET_LOOM_URL = process.env['WARP_QUIET_LOOM_URL'] ?? 'http://127.0.0.1:11445';
const QUIET_LOOM_DEFAULT_MODEL =
  process.env['WARP_QUIET_LOOM_MODEL'] ?? 'mlx-community/Qwen2.5-14B-Instruct-4bit';

export class KeplerCallError extends Error {
  constructor(
    public readonly service: 'embeddings' | 'quiet-loom',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'KeplerCallError';
  }
}

export interface EmbeddingResult {
  readonly vectors: readonly (readonly number[])[];
  readonly dim: number;
  readonly model: string;
}

/**
 * Embed a batch of texts via the embeddings sidecar (sentence-transformers / MiniLM-L6-v2,
 * MPS-accelerated on Kepler). Returns 384-dim normalised vectors.
 */
export async function embed(texts: readonly string[]): Promise<EmbeddingResult> {
  let r: Response;
  try {
    r = await fetch(`${EMBEDDINGS_URL}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
  } catch (e) {
    throw new KeplerCallError(
      'embeddings',
      `Embeddings sidecar unreachable at ${EMBEDDINGS_URL}: ${(e as Error).message}`,
      e,
    );
  }
  if (!r.ok) {
    throw new KeplerCallError(
      'embeddings',
      `Embeddings sidecar /embed -> HTTP ${r.status}: ${await r.text()}`,
    );
  }
  const d = (await r.json()) as { vectors: number[][]; model?: string };
  return {
    vectors: d.vectors,
    dim: d.vectors[0]?.length ?? 0,
    model: d.model ?? 'sentence-transformers/all-MiniLM-L6-v2',
  };
}

export interface QuietLoomCallInput {
  readonly system: string;
  readonly userMessage: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface QuietLoomCallOutput {
  readonly text: string;
  readonly model: string;
  readonly stopReason: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Call the Quiet Loom — Kepler-resident MLX-served local LLM. The HTTP
 * surface is OpenAI-compatible (`/v1/chat/completions`). No auth: the
 * service binds to loopback only and is reachable only by the Loom
 * process running on the same host.
 */
export async function quietLoomChat(input: QuietLoomCallInput): Promise<QuietLoomCallOutput> {
  const model = input.model ?? QUIET_LOOM_DEFAULT_MODEL;
  let r: Response;
  try {
    r = await fetch(`${QUIET_LOOM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.userMessage },
        ],
        max_tokens: input.maxTokens ?? 2048,
        temperature: input.temperature ?? 0.6,
        stream: false,
      }),
    });
  } catch (e) {
    throw new KeplerCallError(
      'quiet-loom',
      `Quiet Loom unreachable at ${QUIET_LOOM_URL}: ${(e as Error).message}`,
      e,
    );
  }
  if (!r.ok) {
    throw new KeplerCallError(
      'quiet-loom',
      `Quiet Loom /v1/chat/completions -> HTTP ${r.status}: ${await r.text()}`,
    );
  }
  const d = (await r.json()) as {
    model: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  const text = d.choices[0]?.message?.content ?? '';
  return {
    text,
    model: d.model ?? model,
    stopReason: d.choices[0]?.finish_reason ?? 'unknown',
    inputTokens: d.usage?.prompt_tokens ?? 0,
    outputTokens: d.usage?.completion_tokens ?? 0,
  };
}

/**
 * Resolve a Spinner manifest's `model` field (e.g. `kepler/qwen-2.5-14b`)
 * to a concrete Quiet Loom model id. The mapping is intentionally explicit
 * so canon-aligned `kepler/<friendly-name>` strings survive Quiet Loom
 * model rotations.
 */
const KEPLER_MODEL_MAP: Readonly<Record<string, string>> = {
  'qwen-2.5-7b': 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  'qwen-2.5-7b-instruct': 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  'qwen-2.5-14b': 'mlx-community/Qwen2.5-14B-Instruct-4bit',
  'qwen-2.5-14b-instruct': 'mlx-community/Qwen2.5-14B-Instruct-4bit',
  // Qwen3 generation — preferred for new Spinners. The Coder variants
  // are tuned for structured / JSON output and outperform the base
  // chat models on Webbase schema synthesis; pick them by manifest
  // model: 'kepler/qwen3-coder-30b' to opt in.
  'qwen3-14b': 'mlx-community/Qwen3-14B-4bit',
  'qwen3-32b': 'mlx-community/Qwen3-32B-4bit',
  'qwen3-coder-30b': 'mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit',
  'qwen3-coder-next': 'mlx-community/Qwen3-Coder-Next-mxfp4',
};

export function resolveKeplerModel(manifestModel: string | undefined): string | null {
  if (!manifestModel) return QUIET_LOOM_DEFAULT_MODEL;
  const parts = manifestModel.split('/');
  if (parts.length !== 2) return null;
  const [provider, model] = parts as [string, string];
  if (provider !== 'kepler') return null;
  return KEPLER_MODEL_MAP[model] ?? model; // pass-through if not in map (raw mlx-community/... names work directly)
}
