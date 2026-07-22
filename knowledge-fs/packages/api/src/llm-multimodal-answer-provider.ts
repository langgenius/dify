import type { PlatformAdapter } from "@knowledge/core";

import type {
  MultimodalAnswerProvider,
  MultimodalAnswerProviderInput,
  MultimodalAnswerProviderResult,
} from "./hybrid-query-generator";
import { cloneJsonObject, isPlainObject } from "./json-utils";

export interface LlmMultimodalAnswerMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export type LlmMultimodalContentBlock =
  | {
      readonly text: string;
      readonly type: "text";
    }
  | {
      readonly imageUrl: {
        readonly detail?: "auto" | "high" | "low" | undefined;
        readonly url: string;
      };
      readonly type: "image_url";
    };

export interface LlmMultimodalContentBlockMessage {
  readonly content: readonly LlmMultimodalContentBlock[];
  readonly role: "assistant" | "system" | "user";
}

export interface GenerateMultimodalAnswerTextInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmMultimodalAnswerMessage[];
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface GenerateMultimodalAnswerTextResult {
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly model?: string | undefined;
  readonly text: string;
}

export interface MultimodalAnswerTextProvider {
  readonly kind?: string | undefined;
  generate(input: GenerateMultimodalAnswerTextInput): Promise<GenerateMultimodalAnswerTextResult>;
}

export interface GenerateMultimodalAnswerContentInput {
  readonly maxOutputTokens?: number | undefined;
  readonly messages: readonly LlmMultimodalContentBlockMessage[];
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly tenantId?: string | undefined;
}

export interface GenerateMultimodalAnswerContentResult {
  readonly finishReason?: string | undefined;
  readonly metadata?: unknown;
  readonly model?: string | undefined;
  readonly text: string;
}

export interface MultimodalAnswerContentProvider {
  readonly kind?: string | undefined;
  generate(
    input: GenerateMultimodalAnswerContentInput,
  ): Promise<GenerateMultimodalAnswerContentResult>;
}

export interface LlmMultimodalAnswerProviderOptions {
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly provider: MultimodalAnswerTextProvider;
  readonly temperature?: number | undefined;
}

export interface ContentBlockMultimodalAnswerProviderOptions {
  readonly assetUrlResolver?:
    | ((
        attachment: MultimodalAnswerProviderInput["multimodalEvidence"][number],
      ) => string | undefined)
    | undefined;
  readonly imageDetail?: "auto" | "high" | "low" | undefined;
  readonly maxImageAttachments?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly provider: MultimodalAnswerContentProvider;
  readonly temperature?: number | undefined;
}

export interface ObjectStorageContentBlockMultimodalAnswerProviderOptions
  extends Omit<ContentBlockMultimodalAnswerProviderOptions, "assetUrlResolver"> {
  readonly maxImageBytes?: number | undefined;
  /** Cap on cumulative image bytes loaded into one request (bounds total VLM payload). */
  readonly maxTotalImageBytes?: number | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly preferredVariant?: string | undefined;
}

export function createLlmMultimodalAnswerProvider({
  maxOutputTokens = 1_000,
  model,
  provider,
  temperature = 0,
}: LlmMultimodalAnswerProviderOptions): MultimodalAnswerProvider {
  if (!model.trim()) {
    throw new Error("LLM multimodal answer model is required");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("LLM multimodal answer maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("LLM multimodal answer temperature must be non-negative");
  }

  return {
    generate: async (input) => {
      const result = await provider.generate({
        maxOutputTokens,
        messages: multimodalAnswerMessages(input),
        model,
        temperature,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      });

      return {
        metadata: {
          ...(provider.kind ? { provider: provider.kind } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.model ? { generationModel: result.model } : {}),
          ...(isPlainObject(result.metadata) ? cloneJsonObject(result.metadata) : {}),
        },
        text: result.text.trim(),
      } satisfies MultimodalAnswerProviderResult;
    },
  };
}

export function createObjectStorageContentBlockMultimodalAnswerProvider({
  maxImageBytes = 10 * 1024 * 1024,
  maxTotalImageBytes = 32 * 1024 * 1024,
  objectStorage,
  preferredVariant = "thumbnail",
  ...options
}: ObjectStorageContentBlockMultimodalAnswerProviderOptions): MultimodalAnswerProvider {
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1) {
    throw new Error("Object-storage multimodal answer maxImageBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxTotalImageBytes) || maxTotalImageBytes < maxImageBytes) {
    throw new Error(
      "Object-storage multimodal answer maxTotalImageBytes must be at least maxImageBytes",
    );
  }

  return {
    generate: async (input) => {
      const dataUrls = await loadObjectBackedImageDataUrls({
        input,
        maxImageBytes,
        maxTotalImageBytes,
        objectStorage,
        preferredVariant,
      });
      const provider = createContentBlockMultimodalAnswerProvider({
        ...options,
        assetUrlResolver: (attachment) => {
          const asset = objectBackedImageAssetRef({ attachment, preferredVariant });
          return asset?.objectKey ? dataUrls.get(asset.objectKey) : undefined;
        },
      });

      return provider.generate(input);
    },
  };
}

export function createContentBlockMultimodalAnswerProvider({
  assetUrlResolver = defaultAssetUrlResolver,
  imageDetail = "auto",
  maxImageAttachments = 8,
  maxOutputTokens = 1_000,
  model,
  provider,
  temperature = 0,
}: ContentBlockMultimodalAnswerProviderOptions): MultimodalAnswerProvider {
  if (!model.trim()) {
    throw new Error("Content-block multimodal answer model is required");
  }

  if (!Number.isInteger(maxImageAttachments) || maxImageAttachments < 0) {
    throw new Error("Content-block multimodal answer maxImageAttachments must be non-negative");
  }

  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Content-block multimodal answer maxOutputTokens must be at least 1");
  }

  if (!Number.isFinite(temperature) || temperature < 0) {
    throw new Error("Content-block multimodal answer temperature must be non-negative");
  }

  return {
    generate: async (input) => {
      const messages = multimodalContentBlockMessages({
        assetUrlResolver,
        imageDetail,
        input,
        maxImageAttachments,
      });
      const result = await provider.generate({
        maxOutputTokens,
        messages,
        model,
        temperature,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      });

      return {
        metadata: {
          imageBlockCount: countImageBlocks(messages),
          ...(provider.kind ? { provider: provider.kind } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.model ? { generationModel: result.model } : {}),
          ...(isPlainObject(result.metadata) ? cloneJsonObject(result.metadata) : {}),
        },
        text: result.text.trim(),
      } satisfies MultimodalAnswerProviderResult;
    },
  };
}

async function loadObjectBackedImageDataUrls({
  input,
  maxImageBytes,
  maxTotalImageBytes,
  objectStorage,
  preferredVariant,
}: {
  readonly input: MultimodalAnswerProviderInput;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly preferredVariant: string;
}): Promise<ReadonlyMap<string, string>> {
  const urls = new Map<string, string>();
  let totalBytes = 0;

  for (const attachment of input.multimodalEvidence) {
    if (!isVisualAttachment(attachment)) {
      continue;
    }

    const asset = objectBackedImageAssetRef({ attachment, preferredVariant });
    if (!asset?.objectKey || urls.has(asset.objectKey)) {
      continue;
    }

    const body = await objectStorage.getObject(asset.objectKey);
    if (!body || body.byteLength > maxImageBytes) {
      continue;
    }

    // Stop once the cumulative image payload would exceed the total budget (base64 inflates ~33%,
    // so the raw-byte budget is a conservative bound on the request size).
    if (totalBytes + body.byteLength > maxTotalImageBytes) {
      break;
    }

    totalBytes += body.byteLength;
    urls.set(
      asset.objectKey,
      `data:${asset.contentType};base64,${Buffer.from(body).toString("base64")}`,
    );
  }

  return urls;
}

function objectBackedImageAssetRef({
  attachment,
  preferredVariant,
}: {
  readonly attachment: MultimodalAnswerProviderInput["multimodalEvidence"][number];
  readonly preferredVariant: string;
}): { readonly contentType: string; readonly objectKey: string } | undefined {
  if (!isPlainObject(attachment.assetRef)) {
    return undefined;
  }

  const variants = isPlainObject(attachment.assetRef.variants)
    ? attachment.assetRef.variants
    : undefined;
  const variant = isPlainObject(variants?.[preferredVariant])
    ? variants[preferredVariant]
    : undefined;
  const candidate = variant ?? attachment.assetRef;
  const objectKey = typeof candidate.objectKey === "string" ? candidate.objectKey.trim() : "";
  const contentType = typeof candidate.contentType === "string" ? candidate.contentType.trim() : "";

  if (!objectKey || !contentType.startsWith("image/")) {
    return undefined;
  }

  return { contentType, objectKey };
}

function multimodalAnswerMessages(
  input: MultimodalAnswerProviderInput,
): readonly LlmMultimodalAnswerMessage[] {
  return [
    {
      content: [
        "Answer the user using only the supplied retrieval evidence and multimodal attachments.",
        "Cite concrete document locations when available, including page, section, and bounding box.",
        "If the visual attachment itself is required but only an asset route is available, say what can be concluded from OCR/caption/text evidence and name the asset route.",
      ].join("\n"),
      role: "system",
    },
    {
      content: [
        `Question: ${input.query}`,
        "",
        "Text evidence:",
        ...input.evidence.map(
          (item, index) =>
            `[E${index + 1}] node=${item.nodeId} page=${item.citation.pageNumber ?? "unknown"} section=${item.citation.sectionPath.join(" / ") || "Document"}\n${item.text}`,
        ),
        "",
        "Multimodal attachments:",
        ...input.multimodalEvidence.map(
          (item, index) =>
            `[M${index + 1}] modality=${item.modality} document=${item.documentAssetId} page=${item.pageNumber ?? "unknown"} section=${item.sectionPath.join(" / ") || "Document"} parseElement=${item.parseElementId ?? "unknown"} bbox=${item.boundingBox ? JSON.stringify(item.boundingBox) : "none"} assetRoute=${item.assetRoute ?? "none"} descriptor=${item.assetDescriptorPath ?? "none"}`,
        ),
      ].join("\n"),
      role: "user",
    },
  ];
}

function multimodalContentBlockMessages({
  assetUrlResolver,
  imageDetail,
  input,
  maxImageAttachments,
}: {
  readonly assetUrlResolver: NonNullable<
    ContentBlockMultimodalAnswerProviderOptions["assetUrlResolver"]
  >;
  readonly imageDetail: NonNullable<ContentBlockMultimodalAnswerProviderOptions["imageDetail"]>;
  readonly input: MultimodalAnswerProviderInput;
  readonly maxImageAttachments: number;
}): readonly LlmMultimodalContentBlockMessage[] {
  const imageBlocks: LlmMultimodalContentBlock[] = [];
  const attachmentTextBlocks: LlmMultimodalContentBlock[] = [];

  for (const [index, attachment] of input.multimodalEvidence.entries()) {
    const label = `M${index + 1}`;
    const url = isVisualAttachment(attachment) ? assetUrlResolver(attachment) : undefined;

    attachmentTextBlocks.push({
      text: multimodalAttachmentLine(label, attachment, url),
      type: "text",
    });

    if (url && imageBlocks.length < maxImageAttachments) {
      imageBlocks.push({
        imageUrl: { detail: imageDetail, url },
        type: "image_url",
      });
    }
  }

  return [
    {
      content: [
        {
          text: [
            "Answer the user using only the supplied retrieval evidence and multimodal attachments.",
            "Inspect image blocks directly when present.",
            "Cite concrete document locations when available, including page, section, and bounding box.",
          ].join("\n"),
          type: "text",
        },
      ],
      role: "system",
    },
    {
      content: [
        {
          text: [
            `Question: ${input.query}`,
            "",
            "Text evidence:",
            ...input.evidence.map(
              (item, index) =>
                `[E${index + 1}] node=${item.nodeId} page=${item.citation.pageNumber ?? "unknown"} section=${item.citation.sectionPath.join(" / ") || "Document"}\n${item.text}`,
            ),
            "",
            "Multimodal attachment metadata:",
          ].join("\n"),
          type: "text",
        },
        ...attachmentTextBlocks,
        ...imageBlocks,
      ],
      role: "user",
    },
  ];
}

function defaultAssetUrlResolver(
  attachment: MultimodalAnswerProviderInput["multimodalEvidence"][number],
): string | undefined {
  if (attachment.assetRoute) {
    return attachment.assetRoute;
  }

  const uri = isPlainObject(attachment.assetRef) ? attachment.assetRef.uri : undefined;

  return typeof uri === "string" && uri.trim() ? uri.trim() : undefined;
}

function isVisualAttachment(
  attachment: MultimodalAnswerProviderInput["multimodalEvidence"][number],
): boolean {
  return attachment.modality === "image" || attachment.modality === "page";
}

function multimodalAttachmentLine(
  label: string,
  attachment: MultimodalAnswerProviderInput["multimodalEvidence"][number],
  imageUrl: string | undefined,
): string {
  return `[${label}] modality=${attachment.modality} document=${attachment.documentAssetId} page=${attachment.pageNumber ?? "unknown"} section=${attachment.sectionPath.join(" / ") || "Document"} parseElement=${attachment.parseElementId ?? "unknown"} bbox=${attachment.boundingBox ? JSON.stringify(attachment.boundingBox) : "none"} imageUrl=${imageUrl ?? "none"} assetRoute=${attachment.assetRoute ?? "none"} descriptor=${attachment.assetDescriptorPath ?? "none"}`;
}

function countImageBlocks(messages: readonly LlmMultimodalContentBlockMessage[]): number {
  return messages.reduce(
    (count, message) =>
      count + message.content.filter((block) => block.type === "image_url").length,
    0,
  );
}
