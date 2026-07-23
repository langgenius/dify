import {
  type GenerateMultimodalAnswerContentResult,
  type LlmMultimodalContentBlock,
  type LlmMultimodalContentBlockMessage,
  type MultimodalAnswerContentProvider,
  type MultimodalAnswerProvider,
  createObjectStorageContentBlockMultimodalAnswerProvider,
} from "@knowledge/api";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
  difyLlmCompletion,
  difyModelRuntimeRequired,
} from "./dify-model-runtime-options";

export interface ApiMultimodalAnswerEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_ATTACHMENTS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_BYTES?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_MODEL?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_MULTIMODAL_ANSWER_TEMPERATURE?: string | undefined;
}

export interface ApiMultimodalAnswerOptions {
  readonly multimodalAnswerProvider?: MultimodalAnswerProvider | undefined;
}

/**
 * Resolves the multimodal (VLM) answer provider. Opt-in: returns `{}` unless
 * `KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER=dify-model-runtime`. Vision routes through Dify's
 * tenant-bound LLM model instance with image content blocks.
 */
export function createApiMultimodalAnswerOptions({
  env = process.env,
  objectStorage,
}: {
  readonly env?: ApiMultimodalAnswerEnv | undefined;
  readonly objectStorage: Parameters<
    typeof createObjectStorageContentBlockMultimodalAnswerProvider
  >[0]["objectStorage"];
}): ApiMultimodalAnswerOptions {
  if (!multimodalAnswerEnabled(env.KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER)) {
    return {};
  }

  return {
    multimodalAnswerProvider: createObjectStorageContentBlockMultimodalAnswerProvider({
      imageDetail: imageDetailEnv(env.KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL),
      maxImageAttachments: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_ATTACHMENTS,
        8,
        "KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_ATTACHMENTS",
      ),
      maxImageBytes: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_BYTES,
        10 * 1024 * 1024,
        "KNOWLEDGE_MULTIMODAL_ANSWER_MAX_IMAGE_BYTES",
      ),
      maxOutputTokens: positiveIntegerEnv(
        env.KNOWLEDGE_MULTIMODAL_ANSWER_MAX_OUTPUT_TOKENS,
        1_000,
        "KNOWLEDGE_MULTIMODAL_ANSWER_MAX_OUTPUT_TOKENS",
      ),
      model: difyModelRuntimeRequired(
        env.KNOWLEDGE_MULTIMODAL_ANSWER_MODEL,
        "KNOWLEDGE_MULTIMODAL_ANSWER_MODEL",
        "multimodal answer generation",
      ),
      objectStorage,
      provider: createDifyMultimodalAnswerContentProvider({
        client: createApiDifyModelRuntimeClient(env),
        pluginId: difyModelRuntimeRequired(
          env.KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID,
          "KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID",
          "multimodal answer generation",
        ),
        provider: difyModelRuntimeRequired(
          env.KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_PROVIDER,
          "KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_PROVIDER",
          "multimodal answer generation",
        ),
      }),
      temperature: nonNegativeNumberEnv(
        env.KNOWLEDGE_MULTIMODAL_ANSWER_TEMPERATURE,
        0,
        "KNOWLEDGE_MULTIMODAL_ANSWER_TEMPERATURE",
      ),
    }),
  };
}

interface DifyMultimodalAnswerContentProviderOptions {
  readonly client: ReturnType<typeof createApiDifyModelRuntimeClient>;
  readonly pluginId: string;
  readonly provider: string;
}

function createDifyMultimodalAnswerContentProvider({
  client,
  pluginId,
  provider,
}: DifyMultimodalAnswerContentProviderOptions): MultimodalAnswerContentProvider {
  return {
    generate: async (input): Promise<GenerateMultimodalAnswerContentResult> => {
      const tenantId = input.tenantId?.trim();

      if (!tenantId) {
        throw new Error("Dify model runtime multimodal answer requires a tenantId");
      }

      const result = await difyLlmCompletion({
        client,
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        model: input.model,
        pluginId,
        promptMessages: input.messages.map(toDifyPromptMessage),
        provider,
        tenantId,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      });

      if (!result.text.trim()) {
        throw new Error("Dify multimodal answer returned empty text");
      }

      return {
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
        metadata: {},
        ...(result.model ? { model: result.model } : {}),
        text: result.text.trim(),
      };
    },
    kind: "dify-model-runtime",
  };
}

function toDifyPromptMessage(message: LlmMultimodalContentBlockMessage): Record<string, unknown> {
  return {
    content: message.content.map(toDifyContentPart),
    role: message.role,
  };
}

// Content parts follow dify's PromptMessageContent entities (graphon message_entities):
// text = `{type:"text", data}`; image = `{type:"image", format, base64_data|url, mime_type,
// detail:"low"|"high"}`. dify has no "auto" detail — it defaults to LOW, so "auto" maps to "low".
function toDifyContentPart(block: LlmMultimodalContentBlock): Record<string, unknown> {
  if (block.type === "text") {
    return { data: block.text, type: "text" };
  }

  const detail = block.imageUrl.detail === "high" ? "high" : "low";
  const parsed = parseImageDataUrl(block.imageUrl.url);

  if (parsed) {
    return {
      base64_data: parsed.base64Data,
      detail,
      format: parsed.format,
      mime_type: parsed.mimeType,
      type: "image",
    };
  }

  // Defensive branch: the pipeline only produces data URLs today, but a remote URL is also a
  // valid ImagePromptMessageContent (mime/format are best-effort from the extension).
  const mimeType = imageMimeTypeFromUrl(block.imageUrl.url);

  return {
    detail,
    format: imageFormatFromMimeType(mimeType),
    mime_type: mimeType,
    type: "image",
    url: block.imageUrl.url,
  };
}

function parseImageDataUrl(
  url: string,
): { base64Data: string; format: string; mimeType: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(url);
  const mimeType = match?.[1];
  const base64Data = match?.[2];

  if (!mimeType || !base64Data) {
    return undefined;
  }

  return { base64Data, format: imageFormatFromMimeType(mimeType), mimeType };
}

function imageFormatFromMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1];

  return subtype ? subtype : "png";
}

function imageMimeTypeFromUrl(url: string): string {
  const extension = /\.([a-zA-Z0-9]+)(?:[?#]|$)/u.exec(url)?.[1]?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "webp" || extension === "gif" || extension === "png") {
    return `image/${extension}`;
  }

  return "image/png";
}

function multimodalAnswerEnabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "dify-model-runtime") {
    return true;
  }

  throw new Error("KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER must be dify-model-runtime or off");
}

function imageDetailEnv(value: string | undefined): "auto" | "high" | "low" {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return "auto";
  }

  if (normalized === "auto" || normalized === "high" || normalized === "low") {
    return normalized;
  }

  throw new Error("KNOWLEDGE_MULTIMODAL_ANSWER_IMAGE_DETAIL must be auto, high, or low");
}

function positiveIntegerEnv(value: string | undefined, fallback: number, name: string): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function nonNegativeNumberEnv(value: string | undefined, fallback: number, name: string): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be non-negative`);
  }

  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
