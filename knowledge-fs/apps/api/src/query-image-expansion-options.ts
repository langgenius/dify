import {
  type ConcurrencyGate,
  type QueryImageExpansionProvider,
  QueryImageExpansionTimeoutError,
} from "@knowledge/api";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
  difyLlmCompletion,
} from "./dify-model-runtime-options";

export interface ApiQueryImageExpansionEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS?: string | undefined;
}

export function createApiQueryImageExpansionProvider(
  env: ApiQueryImageExpansionEnv = process.env,
  modelRequestGate?: ConcurrencyGate,
): QueryImageExpansionProvider {
  const client = createApiDifyModelRuntimeClient(env);
  const timeoutMs = positiveIntegerEnv(
    env.KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS,
    8_000,
    "KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS",
  );

  return {
    expand: async (input) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new QueryImageExpansionTimeoutError()),
        timeoutMs,
      );
      const signal = input.signal
        ? AbortSignal.any([input.signal, controller.signal])
        : controller.signal;
      try {
        signal.throwIfAborted();
        const request = () =>
          difyLlmCompletion({
            client,
            maxOutputTokens: 512,
            model: input.model.model,
            pluginId: input.model.pluginId,
            promptMessages: [
              {
                content:
                  "Return only strict JSON with keys description (string), ocrText (string), and keywords (string array). Describe the user's images and transcribe useful visible text for document retrieval. Do not answer the user's question.",
                role: "system",
              },
              {
                content: [
                  {
                    data: input.query.trim()
                      ? `Optional text query: ${input.query.trim()}`
                      : "Build a semantic navigation query from these images.",
                    type: "text",
                  },
                  ...input.images.map((image) => ({
                    base64_data: Buffer.from(image.body).toString("base64"),
                    detail: "low",
                    format: image.mimeType === "image/jpeg" ? "jpeg" : image.mimeType.split("/")[1],
                    mime_type: image.mimeType,
                    type: "image",
                  })),
                ],
                role: "user",
              },
            ],
            provider: input.model.provider,
            signal,
            temperature: 0,
            tenantId: input.tenantId,
          });
        const result = modelRequestGate
          ? await modelRequestGate.run(request, { signal })
          : await request();
        const parsed = parseQueryImageExpansionOutput(result.text);
        return {
          ...parsed,
          metadata: {
            ...(result.finishReason ? { finishReason: result.finishReason } : {}),
            model: result.model ?? input.model.model,
            provider: input.model.provider,
          },
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new QueryImageExpansionTimeoutError(undefined, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function parseQueryImageExpansionOutput(value: string): {
  readonly description: string;
  readonly keywords: readonly string[];
  readonly ocrText: string;
} {
  const parsed = JSON.parse(stripJsonFence(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Query image expansion output must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "description" && key !== "keywords" && key !== "ocrText",
    ) ||
    typeof record.description !== "string" ||
    record.description.length > 4_000 ||
    typeof record.ocrText !== "string" ||
    record.ocrText.length > 8_000 ||
    !Array.isArray(record.keywords) ||
    record.keywords.length > 32 ||
    record.keywords.some(
      (keyword) => typeof keyword !== "string" || keyword.length < 1 || keyword.length > 200,
    )
  ) {
    throw new Error("Query image expansion output does not match the required contract");
  }
  return {
    description: record.description,
    keywords: record.keywords as string[],
    ocrText: record.ocrText,
  };
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function positiveIntegerEnv(value: string | undefined, fallback: number, name: string): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
