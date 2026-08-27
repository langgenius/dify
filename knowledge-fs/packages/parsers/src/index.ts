import { Buffer } from "node:buffer";

import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { DomUtils, parseDocument } from "htmlparser2";
import { type Token, type Tokens, marked } from "marked";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  type ParseArtifact,
  ParseArtifactSchema,
  type ParseElement,
  ParseElementSchema,
} from "@knowledge/core";

export type ParserKind = "native-html" | "native-markdown" | "native-structured" | "unstructured";

export interface ParseDocumentInput {
  readonly body: Uint8Array;
  readonly documentAssetId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly parserHints?: ParserRouteHints;
  readonly signal?: AbortSignal;
  readonly version: number;
}

export interface ParserRouteHints {
  /** A downstream handler can materialize PDF images from provider-supplied coordinates. */
  readonly imagesHandledExternally?: boolean;
  readonly language?: string;
  readonly layoutComplexity?: "complex" | "simple";
  /** Request provider-side image extraction when no cheaper local extractor exists. */
  readonly requiresImages?: boolean;
  readonly requiresOcr?: boolean;
  readonly requiresTables?: boolean;
}

export interface ParserAdapter {
  readonly kind: ParserKind;
  parse(input: ParseDocumentInput): Promise<ParseArtifact>;
}

export type ProviderErrorCode =
  | "provider_input"
  | "provider_rate_limited"
  | "provider_request_failed"
  | "provider_response_invalid";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    {
      cause,
      code,
      retryable = false,
      status,
    }: {
      readonly cause?: unknown;
      readonly code: ProviderErrorCode;
      readonly retryable?: boolean;
      readonly status?: number;
    },
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export class ProviderInputError extends ProviderError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { ...options, code: "provider_input" });
    this.name = "ProviderInputError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {},
  ) {
    super(message, { ...options, code: "provider_rate_limited", retryable: true });
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderRequestError extends ProviderError {
  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly retryable?: boolean;
      readonly status?: number;
    } = {},
  ) {
    super(message, {
      ...options,
      code: "provider_request_failed",
      retryable:
        options.retryable ??
        (options.status !== undefined && isRetryableProviderStatus(options.status)),
    });
    this.name = "ProviderRequestError";
  }
}

export class ProviderResponseError extends ProviderError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {},
  ) {
    super(message, { ...options, code: "provider_response_invalid" });
    this.name = "ProviderResponseError";
  }
}

export interface NativeParserOptions {
  readonly generateId?: () => string;
  readonly maxElements?: number;
  readonly maxInputBytes?: number;
  readonly now?: () => string;
  readonly parserVersion?: string;
}

export interface UnstructuredParserClientOptions extends NativeParserOptions {
  readonly apiKey?: string;
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
  readonly maxResponseBytes?: number;
  readonly maxConcurrency?: number;
  readonly maxRetries?: number;
  readonly requestTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface StructuredDataParserOptions extends NativeParserOptions {
  readonly maxRows?: number;
}

export interface ParserRouterOptions {
  readonly html: ParserAdapter;
  readonly markdown: ParserAdapter;
  readonly maxNativeInputBytes?: number;
  readonly nativeLanguages?: readonly string[];
  readonly structured?: ParserAdapter;
  readonly unstructured: ParserAdapter;
}

type ParseElementInput = Omit<ParseElement, "id">;

interface HtmlNode {
  readonly attribs?: Readonly<Record<string, string>>;
  readonly children?: readonly HtmlNode[];
  readonly name?: string;
  readonly type?: string;
}

interface MarkdownImageRef {
  readonly alt?: string | undefined;
  readonly contentType?: string | undefined;
  readonly title?: string | undefined;
  readonly uri: string;
}

const defaultMaxElements = 20_000;
const defaultMaxInputBytes = 10 * 1024 * 1024;
const defaultMaxDocumentTitleChars = 2_000;
const defaultMaxArchiveImageBytes = 10 * 1024 * 1024;
const defaultMaxArchiveImageCount = 1_000;
const defaultMaxArchiveImageTotalBytes = 32 * 1024 * 1024;
const archivePathCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
// Image blocks are returned as base64 in the partition JSON. Keep the response bounded while
// leaving enough headroom for the encoded images of ordinary PDF, Office, and presentation files.
const defaultMaxResponseBytes = 32 * 1024 * 1024;
const defaultMaxConcurrency = 2;
const defaultMaxRetries = 0;
const defaultRequestTimeoutMs = 120_000;
const defaultMaxRows = 20_000;
const defaultRetryDelayMs = 100;
const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();
const unstructuredDocumentExtensions = new Set([
  "doc",
  "docx",
  "eml",
  "epub",
  "msg",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "xls",
  "xlsx",
]);

const UnstructuredElementSchema = z.object({
  element_id: z.string().min(1).max(512).optional(),
  metadata: z
    .object({
      page_number: z.number().int().positive().optional(),
    })
    .passthrough()
    .default({}),
  text: z.string().optional(),
  type: z.string().optional(),
});
const UnstructuredResponseSchema = z.array(UnstructuredElementSchema);

export function createNativeMarkdownParser(options: NativeParserOptions = {}): ParserAdapter {
  return {
    kind: "native-markdown",
    parse: async (input) => {
      const isMdx = isMdxInput(input);
      const parserVersion = options.parserVersion ?? (isMdx ? "native-mdx@2" : "native-markdown@2");
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const text = decodeUtf8(input.body);
      const tokens = marked.lexer(text, { gfm: true });
      const elements = markdownTokensToElements(tokens, { preserveHtmlText: isMdx });

      return createParseArtifact({
        elements,
        input,
        kind: "native-markdown",
        options,
        parserVersion,
      });
    },
  };
}

export function createNativeHtmlParser(options: NativeParserOptions = {}): ParserAdapter {
  return {
    kind: "native-html",
    parse: async (input) => {
      const parserVersion = options.parserVersion ?? "native-html@3";
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const text = decodeUtf8(input.body);
      const document = parseDocument(text, {
        lowerCaseAttributeNames: true,
        lowerCaseTags: true,
      });
      const nodes = document.children as HtmlNode[];
      const elements = htmlNodesToElements(nodes);
      const documentTitle = htmlDocumentTitle(nodes);

      return createParseArtifact({
        ...(documentTitle ? { artifactMetadata: { documentTitle } } : {}),
        elements,
        input,
        kind: "native-html",
        options,
        parserVersion,
      });
    },
  };
}

export function createNativeStructuredDataParser(
  options: StructuredDataParserOptions = {},
): ParserAdapter {
  return {
    kind: "native-structured",
    parse: async (input) => {
      const parserVersion = options.parserVersion ?? "native-structured@2";
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const text = decodeUtf8(input.body);
      const format = structuredDataFormat(input);

      if (!format) {
        throw new Error("Structured parser unsupported file type");
      }

      const elements = structuredDataElements(format, text, options.maxRows ?? defaultMaxRows);

      return createParseArtifact({
        elements,
        input,
        kind: "native-structured",
        options,
        parserVersion,
      });
    },
  };
}

export function createUnstructuredParserClient({
  apiKey,
  endpoint,
  fetch: fetchImpl = fetch,
  maxConcurrency = defaultMaxConcurrency,
  maxResponseBytes = defaultMaxResponseBytes,
  maxRetries = defaultMaxRetries,
  requestTimeoutMs = defaultRequestTimeoutMs,
  retryDelayMs = defaultRetryDelayMs,
  sleep = sleepMs,
  ...options
}: UnstructuredParserClientOptions): ParserAdapter {
  validateRetryOptions({ maxRetries, retryDelayMs });
  validateUnstructuredResourceOptions({ maxConcurrency, requestTimeoutMs });
  const requestGate = createAbortAwareConcurrencyGate(maxConcurrency);

  return {
    kind: "unstructured",
    parse: async (input) =>
      requestGate.run(async () => {
        const deadline = createUnstructuredRequestDeadline(input.signal, requestTimeoutMs);
        try {
          const parserVersion = options.parserVersion ?? "unstructured@7";
          const partitionStrategy = unstructuredPartitionStrategy(input);
          const providerImageBlockTypes = unstructuredProviderImageBlockTypes(input);
          assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
          const response = await fetchWithRetries({
            buildRequest: () => {
              const form = new FormData();
              const fileBody = input.body.buffer.slice(
                input.body.byteOffset,
                input.body.byteOffset + input.body.byteLength,
              ) as ArrayBuffer;
              form.set("files", new File([fileBody], input.filename, { type: input.mimeType }));
              form.set("coordinates", "true");
              form.set("strategy", partitionStrategy);
              if (providerImageBlockTypes.length > 0) {
                for (const blockType of providerImageBlockTypes) {
                  form.append("extract_image_block_types", blockType);
                }
                form.set("extract_image_block_to_payload", "true");
              }

              return new Request(unstructuredPartitionEndpoint(endpoint), {
                body: form,
                method: "POST",
                ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
                signal: deadline.signal,
              });
            },
            fetchImpl,
            maxRetries,
            retryDelayMs,
            sleep,
            signal: deadline.signal,
          });

          if (!response.ok) {
            throw providerRequestError("Unstructured parser", response.status);
          }

          const responseText = await boundedResponseText(response, maxResponseBytes);
          let payload: unknown;

          try {
            payload = JSON.parse(responseText);
          } catch (error) {
            throw new ProviderResponseError("Unstructured parser returned an invalid response", {
              cause: error,
            });
          }

          const parsed = UnstructuredResponseSchema.safeParse(payload);

          if (!parsed.success) {
            throw new ProviderResponseError("Unstructured parser returned an invalid response");
          }

          const providerElements = unstructuredElementsToElements(
            normalizeUnstructuredLayout(parsed.data),
          );
          const elements = appendArchiveMediaFallbackElements(input, providerElements);

          const artifact = await createParseArtifact({
            artifactHashContext: unstructuredArtifactHashContext(input, {
              partitionStrategy,
              providerImageBlockTypes,
            }),
            elements,
            input,
            kind: "unstructured",
            options,
            parserVersion,
          });
          deadline.throwIfExpired();
          return artifact;
        } catch (error) {
          if (deadline.expired()) {
            throw new ProviderRequestError(
              `Unstructured parser request timed out after requestTimeoutMs=${requestTimeoutMs}`,
              { cause: error, retryable: true },
            );
          }
          if (input.signal?.aborted) {
            throw abortSignalReason(input.signal);
          }
          throw error;
        } finally {
          deadline.dispose();
        }
      }, input.signal),
  };
}

function unstructuredPartitionStrategy(input: ParseDocumentInput): "auto" | "fast" | "hi_res" {
  const hints = input.parserHints;
  if (
    hints?.requiresOcr ||
    hints?.layoutComplexity === "complex" ||
    hints?.requiresTables ||
    shouldRequestProviderImages(input) ||
    (hints?.requiresImages === true && isPdf(input))
  ) {
    return "hi_res";
  }
  if (hints?.layoutComplexity === "simple") {
    return "fast";
  }
  return "auto";
}

function shouldRequestProviderImages(input: ParseDocumentInput): boolean {
  return unstructuredProviderImageBlockTypes(input).length > 0;
}

function unstructuredProviderImageBlockTypes(
  input: ParseDocumentInput,
): readonly ("Image" | "Table")[] {
  if (
    input.parserHints?.requiresImages !== true ||
    providerImagesHandledOutsideUnstructured(input)
  ) {
    return [];
  }

  // PDF fallback mirrors the local rasterizer, which materializes both figures and tables. Other
  // formats retain the narrower historical Image-only request to avoid increasing payload sizes.
  return isPdf(input) ? ["Image", "Table"] : ["Image"];
}

function providerImagesHandledOutsideUnstructured(input: ParseDocumentInput): boolean {
  if (archiveMediaRoots(input) !== null) {
    return true;
  }

  return isPdf(input) && input.parserHints?.imagesHandledExternally === true;
}

function isPdf(input: ParseDocumentInput): boolean {
  return normalizedMimeType(input.mimeType) === "application/pdf";
}

function normalizedMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function unstructuredArtifactHashContext(
  input: ParseDocumentInput,
  request: {
    readonly partitionStrategy: "auto" | "fast" | "hi_res";
    readonly providerImageBlockTypes: readonly ("Image" | "Table")[];
  },
): string {
  const hints = input.parserHints;

  return JSON.stringify({
    filename: input.filename,
    mimeType: input.mimeType.trim().toLowerCase(),
    parserHints: {
      imagesHandledExternally: hints?.imagesHandledExternally === true,
      language: hints?.language?.trim().toLowerCase() || null,
      layoutComplexity: hints?.layoutComplexity ?? null,
      requiresImages: hints?.requiresImages === true,
      requiresOcr: hints?.requiresOcr === true,
      requiresTables: hints?.requiresTables === true,
    },
    request: {
      coordinates: true,
      imageBlockTypes: request.providerImageBlockTypes,
      imagePayload: request.providerImageBlockTypes.length > 0,
      strategy: request.partitionStrategy,
    },
  });
}

function unstructuredPartitionEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");

  return trimmed.endsWith("/general/v0/general") ? trimmed : `${trimmed}/general/v0/general`;
}

function appendArchiveMediaFallbackElements(
  input: ParseDocumentInput,
  elements: readonly ParseElementInput[],
): ParseElementInput[] {
  const roots = archiveMediaRoots(input);

  if (!roots || !zipSignatureIsSupported(input.body)) {
    return [...elements];
  }

  const providerImageUris = elements.flatMap((element) => {
    const uri = parseElementEmbeddedImageUri(element);
    return uri ? [uri] : [];
  });
  const embeddedImageUris = new Set(providerImageUris);
  // Keep the combined provider + archive payload within the same count/byte budgets consumed by
  // the downstream object-storage extractor. This avoids producing an inline asset that would be
  // stranded after the extraction cap is reached.
  let selectedBytes = providerImageUris.reduce(
    (total, uri) => total + embeddedImageDataUriByteLength(uri),
    0,
  );
  let selectedCount = providerImageUris.length;

  try {
    const archive = unzipSync(input.body, {
      filter: (file) => {
        if (
          selectedCount >= defaultMaxArchiveImageCount ||
          file.originalSize < 1 ||
          file.originalSize > defaultMaxArchiveImageBytes ||
          selectedBytes + file.originalSize > defaultMaxArchiveImageTotalBytes ||
          !archivePathIsSafe(file.name) ||
          !archivePathMatchesRoots(file.name, roots) ||
          !archiveImageContentType(file.name)
        ) {
          return false;
        }

        selectedBytes += file.originalSize;
        selectedCount += 1;
        return true;
      },
    });
    const fallbackElements = Object.entries(archive)
      .sort(([left], [right]) => archivePathCollator.compare(left, right))
      .flatMap(([archivePath, body]): ParseElementInput[] => {
        const contentType = archiveImageContentType(archivePath);
        const uri = contentType
          ? `data:${contentType};base64,${Buffer.from(body).toString("base64")}`
          : null;

        if (
          !contentType ||
          !uri ||
          embeddedImageUris.has(uri) ||
          body.byteLength < 1 ||
          body.byteLength > defaultMaxArchiveImageBytes
        ) {
          return [];
        }

        const title = archivePath.split("/").at(-1);

        return [
          {
            metadata: {
              archivePath,
              assetRef: {
                contentType,
                uri,
              },
              positionUnknown: true,
              source: "archive-media-fallback",
              ...(title ? { title } : {}),
            },
            sectionPath: [],
            type: "image",
          },
        ];
      });

    return [...elements, ...fallbackElements];
  } catch {
    // The authoritative parser response remains usable even when an optional archive-media
    // fallback cannot inspect a malformed or unsupported ZIP container.
    return [...elements];
  }
}

function parseElementEmbeddedImageUri(element: ParseElementInput): string | null {
  if (element.type !== "image") {
    return null;
  }

  const assetRef = isPlainRecord(element.metadata?.assetRef) ? element.metadata.assetRef : null;
  const uri = typeof assetRef?.uri === "string" ? assetRef.uri.trim() : "";
  return uri.startsWith("data:image/") ? uri : null;
}

function embeddedImageDataUriByteLength(uri: string): number {
  const encoded = uri.slice(uri.indexOf(",") + 1).replaceAll(/\s+/gu, "");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function archiveMediaRoots(input: ParseDocumentInput): readonly string[] | null {
  const filename = input.filename.trim().toLowerCase();
  const mimeType = input.mimeType.trim().toLowerCase();

  if (
    [".docm", ".docx", ".dotm", ".dotx"].some((extension) => filename.endsWith(extension)) ||
    mimeType.includes("wordprocessingml") ||
    mimeType.includes("ms-word.document.macroenabled")
  ) {
    return ["word/media/"];
  }

  if (
    [".potm", ".potx", ".ppsm", ".ppsx", ".pptm", ".pptx"].some((extension) =>
      filename.endsWith(extension),
    ) ||
    mimeType.includes("presentationml") ||
    mimeType.includes("ms-powerpoint.presentation.macroenabled")
  ) {
    return ["ppt/media/"];
  }

  if (
    [".xlsb", ".xlsm", ".xlsx", ".xltm", ".xltx"].some((extension) =>
      filename.endsWith(extension),
    ) ||
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel.sheet.macroenabled") ||
    mimeType.includes("ms-excel.sheet.binary.macroenabled")
  ) {
    return ["xl/media/"];
  }

  if (filename.endsWith(".vsdx") || mimeType.includes("visio.drawing")) {
    return ["visio/media/"];
  }

  if (
    [".odp", ".ods", ".odt"].some((extension) => filename.endsWith(extension)) ||
    mimeType.startsWith("application/vnd.oasis.opendocument.")
  ) {
    return ["Pictures/"];
  }

  if (filename.endsWith(".epub") || mimeType === "application/epub+zip") {
    return [""];
  }

  return null;
}

function archivePathIsSafe(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized === path &&
    !normalized.startsWith("/") &&
    !normalized.includes("\0") &&
    !normalized.split("/").includes("..")
  );
}

function archivePathMatchesRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(root));
}

function archiveImageContentType(path: string): string | null {
  const normalized = path.toLowerCase();

  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".webp")) return "image/webp";
  return null;
}

function zipSignatureIsSupported(body: Uint8Array): boolean {
  return (
    body.byteLength >= 4 &&
    body[0] === 0x50 &&
    body[1] === 0x4b &&
    ((body[2] === 0x03 && body[3] === 0x04) ||
      (body[2] === 0x05 && body[3] === 0x06) ||
      (body[2] === 0x07 && body[3] === 0x08))
  );
}

export function createParserRouter({
  html,
  markdown,
  maxNativeInputBytes,
  nativeLanguages,
  structured,
  unstructured,
}: ParserRouterOptions): ParserAdapter {
  return {
    kind: "unstructured",
    parse: async (input) => {
      const route = selectParser(input, {
        html,
        markdown,
        ...(maxNativeInputBytes === undefined ? {} : { maxNativeInputBytes }),
        ...(nativeLanguages === undefined ? {} : { nativeLanguages }),
        ...(structured === undefined ? {} : { structured }),
        unstructured,
      });
      const artifact = await route.parser.parse(input);

      return ParseArtifactSchema.parse({
        ...artifact,
        metadata: {
          ...artifact.metadata,
          routeReason: route.reason,
          routedParser: route.parser.kind,
        },
      });
    },
  };
}

function selectParser(
  input: ParseDocumentInput,
  {
    html,
    markdown,
    maxNativeInputBytes = defaultMaxInputBytes,
    nativeLanguages,
    structured,
    unstructured,
  }: ParserRouterOptions,
): { readonly parser: ParserAdapter; readonly reason: string } {
  if (maxNativeInputBytes < 1) {
    throw new Error("Parser router maxNativeInputBytes must be at least 1");
  }

  const mimeType = input.mimeType.toLowerCase();
  const filename = input.filename.toLowerCase();
  const language = input.parserHints?.language?.trim().toLowerCase();

  if (input.parserHints?.requiresOcr) {
    return { parser: unstructured, reason: "ocr-required" };
  }

  if (input.parserHints?.layoutComplexity === "complex") {
    return { parser: unstructured, reason: "complex-layout" };
  }

  if (
    language &&
    nativeLanguages &&
    !nativeLanguages.map((value) => value.toLowerCase()).includes(language)
  ) {
    return { parser: unstructured, reason: "unsupported-native-language" };
  }

  if (unstructuredDocumentExtensions.has(filename.split(".").at(-1) ?? "")) {
    return { parser: unstructured, reason: "complex-file-type" };
  }

  const structuredFormat = structuredDataFormat(input);

  if (structuredFormat && input.body.byteLength > maxNativeInputBytes) {
    return { parser: unstructured, reason: "native-size-limit" };
  }

  if (structured && structuredFormat) {
    return { parser: structured, reason: "structured-file-type" };
  }

  const nativeParser =
    mimeType === "text/markdown" ||
    mimeType === "text/mdx" ||
    mimeType === "text/plain" ||
    mimeType === "text/vtt" ||
    mimeType === "text/x-java-properties" ||
    filename.endsWith(".md") ||
    filename.endsWith(".markdown") ||
    filename.endsWith(".mdx") ||
    filename.endsWith(".properties") ||
    filename.endsWith(".vtt")
      ? markdown
      : mimeType === "text/html" ||
          mimeType === "application/xhtml+xml" ||
          filename.endsWith(".html") ||
          filename.endsWith(".htm")
        ? html
        : null;

  if (!nativeParser) {
    return { parser: unstructured, reason: "unsupported-file-type" };
  }

  if (input.body.byteLength > maxNativeInputBytes) {
    return { parser: unstructured, reason: "native-size-limit" };
  }

  return { parser: nativeParser, reason: "native-file-type" };
}

async function createParseArtifact({
  artifactHashContext,
  artifactMetadata,
  elements,
  input,
  kind,
  options,
  parserVersion,
}: {
  readonly artifactHashContext?: string | undefined;
  readonly artifactMetadata?: Readonly<Record<string, unknown>> | undefined;
  readonly elements: readonly ParseElementInput[];
  readonly input: ParseDocumentInput;
  readonly kind: ParserKind;
  readonly options: NativeParserOptions;
  readonly parserVersion: string;
}): Promise<ParseArtifact> {
  const maxElements = options.maxElements ?? defaultMaxElements;

  if (elements.length > maxElements) {
    throw new Error(`Parser output exceeds maxElements=${maxElements}`);
  }

  const id = (options.generateId ?? defaultGenerateId)();
  const materializedElements = elements.map((element, index) =>
    ParseElementSchema.parse({
      ...element,
      id: `${id}:element-${index + 1}`,
      metadata: cloneMetadata(element.metadata ?? {}),
      sectionPath: [...(element.sectionPath ?? [])],
    }),
  );

  return ParseArtifactSchema.parse({
    artifactHash: await artifactHash(parserVersion, input.body, artifactHashContext),
    contentType: inferContentType(materializedElements),
    createdAt: (options.now ?? defaultNow)(),
    documentAssetId: input.documentAssetId,
    elements: materializedElements,
    id,
    metadata: {
      ...cloneMetadata(artifactMetadata ?? {}),
      filename: input.filename,
      mimeType: input.mimeType,
      parserVersion,
    },
    parser: kind,
    version: input.version,
  });
}

type StructuredDataFormat = "csv" | "json" | "jsonl" | "xml" | "yaml";

function structuredDataFormat({
  filename,
  mimeType,
}: Pick<ParseDocumentInput, "filename" | "mimeType">): StructuredDataFormat | null {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedFilename = filename.toLowerCase();

  if (normalizedMime === "text/csv" || normalizedFilename.endsWith(".csv")) {
    return "csv";
  }

  if (normalizedFilename.endsWith(".jsonl") || normalizedFilename.endsWith(".ndjson")) {
    return "jsonl";
  }

  if (normalizedFilename.endsWith(".json")) {
    return "json";
  }

  if (normalizedMime === "application/x-ndjson" || normalizedMime === "application/jsonl") {
    return "jsonl";
  }

  if (normalizedMime === "application/json" || normalizedMime === "text/json") {
    return "json";
  }

  if (
    normalizedMime === "application/yaml" ||
    normalizedMime === "text/yaml" ||
    normalizedMime === "application/x-yaml" ||
    normalizedFilename.endsWith(".yaml") ||
    normalizedFilename.endsWith(".yml")
  ) {
    return "yaml";
  }

  if (
    normalizedMime === "application/xml" ||
    normalizedMime === "text/xml" ||
    normalizedFilename.endsWith(".xml")
  ) {
    return "xml";
  }

  return null;
}

function structuredDataElements(
  format: StructuredDataFormat,
  text: string,
  maxRows: number,
): ParseElementInput[] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("Structured parser maxRows must be at least 1");
  }

  try {
    if (format === "csv") {
      return rowsToTableElements(format, parseCsvRows(text, maxRows), maxRows);
    }

    if (format === "jsonl") {
      return rowsToTableElements(format, parseJsonLines(text, maxRows), maxRows);
    }

    if (format === "json") {
      return structuredValueElements(format, JSON.parse(text), maxRows);
    }

    if (format === "yaml") {
      return structuredValueElements(format, parseYaml(text), maxRows);
    }

    return structuredValueElements(format, new XMLParser().parse(text), maxRows);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Structured parser")) {
      throw error;
    }

    throw new Error("Structured parser returned an invalid response");
  }
}

function parseCsvRows(text: string, maxRows: number): Record<string, unknown>[] {
  let rows = 0;

  return parseCsv(text, {
    columns: true,
    on_record: (record) => {
      rows += 1;

      if (rows > maxRows) {
        throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
      }

      return record as Record<string, unknown>;
    },
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, unknown>[];
}

function parseJsonLines(text: string, maxRows: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (rows.length >= maxRows) {
      throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
    }

    rows.push(JSON.parse(line) as Record<string, unknown>);
  }

  return rows;
}

function structuredValueElements(
  format: StructuredDataFormat,
  value: unknown,
  maxRows: number,
): ParseElementInput[] {
  if (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === "object" && !Array.isArray(item))
  ) {
    return rowsToTableElements(format, value as Record<string, unknown>[], maxRows);
  }

  return [
    {
      metadata: {
        format,
        rootType: Array.isArray(value) ? "array" : typeof value,
      },
      sectionPath: [],
      text: JSON.stringify(value, null, 2),
      type: "code",
    },
  ];
}

function rowsToTableElements(
  format: StructuredDataFormat,
  rows: readonly Record<string, unknown>[],
  maxRows: number,
): ParseElementInput[] {
  if (rows.length > maxRows) {
    throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
  }

  const columns = uniqueStrings(rows.flatMap((row) => Object.keys(row)));
  const headerRowCount = format === "csv" ? 1 : 0;
  const projection = projectTableRecords({
    columns,
    headerRowCount,
    rows: rows.map((row) => columns.map((column) => structuredCell(row[column]))),
  });

  return [
    {
      metadata: {
        columns,
        format,
        rowCount: rows.length,
        table: projection.metadata,
      },
      sectionPath: [],
      text: projection.text,
      type: "table",
    },
  ];
}

type TableSemanticMode = "matrix" | "record-list" | "single-record" | "unknown";

interface TableProjection {
  readonly metadata: {
    readonly columns: readonly string[];
    readonly headerRowCount: number;
    readonly mode: TableSemanticMode;
    readonly recordCount: number;
    readonly semanticVersion: 1;
    readonly sourceRowCount: number;
  };
  readonly text: string;
}

function projectTableRecords({
  columns: rawColumns,
  headerRowCount,
  mode,
  rows,
  sourceRowCount,
}: {
  readonly columns: readonly string[];
  readonly headerRowCount: number;
  readonly mode?: TableSemanticMode | undefined;
  readonly rows: readonly (readonly string[])[];
  readonly sourceRowCount?: number | undefined;
}): TableProjection {
  let width = Math.max(rawColumns.length, 1);
  for (const row of rows) width = Math.max(width, row.length);
  const columnCounts = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, index) => {
    const value = normalizeTableCell(rawColumns[index] ?? "");
    const base = value || `column_${index + 1}`;
    const count = (columnCounts.get(base) ?? 0) + 1;
    columnCounts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
  const lines: string[] = [];
  let matrixCellCount = 0;
  let numericCellCount = 0;
  for (const row of rows) {
    const cells: string[] = [];
    for (let index = 0; index < columns.length; index += 1) {
      const value = normalizeTableCell(row[index] ?? "");
      cells.push(value);
      if (index === 0 || !value) continue;
      matrixCellCount += 1;
      if (tableCellValueKind(value) === "number") numericCellCount += 1;
    }
    lines.push(columns.map((column, index) => `${column}: ${cells[index]}`).join(" | "));
  }
  const resolvedMode =
    mode ??
    classifyTableSemanticMode({
      columnCount: columns.length,
      matrixCellCount,
      numericCellCount,
      rowCount: rows.length,
    });
  const text = lines.join("\n");

  return {
    metadata: {
      columns,
      headerRowCount,
      mode: resolvedMode,
      recordCount: rows.length,
      semanticVersion: 1,
      sourceRowCount: sourceRowCount ?? headerRowCount + rows.length,
    },
    text: text || columns.join(" | "),
  };
}

function classifyTableSemanticMode({
  columnCount,
  matrixCellCount,
  numericCellCount,
  rowCount,
}: {
  readonly columnCount: number;
  readonly matrixCellCount: number;
  readonly numericCellCount: number;
  readonly rowCount: number;
}): TableSemanticMode {
  if (rowCount === 0) return "unknown";
  if (rowCount === 1) return "single-record";
  if (columnCount >= 3 && matrixCellCount > 0 && numericCellCount / matrixCellCount >= 0.7) {
    return "matrix";
  }
  return "record-list";
}

function structuredCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function markdownTokensToElements(
  tokens: readonly Token[],
  { preserveHtmlText }: { readonly preserveHtmlText: boolean },
): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];

  for (const token of tokens) {
    if (token.type === "space") {
      continue;
    }

    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      const text = normalizeText(heading.text);

      if (!text) {
        continue;
      }

      sectionPath.length = Math.max(heading.depth - 1, 0);
      sectionPath[heading.depth - 1] = text;
      const compactPath = compactSectionPath(sectionPath);
      sectionPath.length = compactPath.length;
      sectionPath.splice(0, compactPath.length, ...compactPath);
      elements.push({
        metadata: { depth: heading.depth },
        sectionPath: compactPath,
        text,
        type: "heading",
      });
      continue;
    }

    if (token.type === "paragraph") {
      const paragraph = token as Tokens.Paragraph;
      const images = markdownImagesFromToken(paragraph);
      for (const image of images) {
        pushImageElement(elements, sectionPath, {
          assetRef: {
            ...(image.contentType ? { contentType: image.contentType } : {}),
            uri: image.uri,
          },
          caption: image.alt,
          source: "markdown-image",
          ...(image.title ? { title: image.title } : {}),
        });
      }

      if (images.length > 0 && normalizeText(paragraph.text).startsWith("![")) {
        continue;
      }

      pushTextElement(elements, "paragraph", paragraph.text, sectionPath);
      continue;
    }

    if (token.type === "html" && preserveHtmlText) {
      const html = token as Tokens.HTML;
      pushTextElement(elements, "paragraph", markdownHtmlBlockText(html.text), sectionPath);
      continue;
    }

    if (token.type === "list") {
      const list = token as Tokens.List;
      pushTextElement(
        elements,
        "list",
        list.items.map((item) => item.text).join("\n"),
        sectionPath,
      );
      continue;
    }

    if (token.type === "code") {
      const code = token as Tokens.Code;
      pushTextElement(elements, "code", code.text, sectionPath, {
        ...(code.lang ? { language: code.lang } : {}),
      });
      continue;
    }

    if (token.type === "table") {
      const table = token as Tokens.Table;
      const projection = markdownTableProjection(table);
      pushTextElement(elements, "table", projection.text, sectionPath, {
        table: projection.metadata,
      });
    }
  }

  return elements;
}

function isMdxInput({
  filename,
  mimeType,
}: Pick<ParseDocumentInput, "filename" | "mimeType">): boolean {
  return (
    mimeType.trim().toLowerCase() === "text/mdx" || filename.trim().toLowerCase().endsWith(".mdx")
  );
}

function markdownHtmlBlockText(source: string): string {
  const document = parseDocument(source, {
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
  });
  const nodes = document.children as HtmlNode[];

  return nodes.map(searchableMarkdownHtmlText).join("\n");
}

function searchableMarkdownHtmlText(node: HtmlNode): string {
  const name = node.name?.toLowerCase();
  if (name && ["script", "style", "noscript"].includes(name)) {
    return "";
  }

  if (!node.children?.length) {
    return htmlText(node);
  }

  return node.children.map(searchableMarkdownHtmlText).join("\n");
}

function htmlNodesToElements(nodes: readonly HtmlNode[]): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];

  for (const node of nodes) {
    visitHtmlNode(node, elements, sectionPath);
  }

  return elements;
}

function htmlDocumentTitle(nodes: readonly HtmlNode[]): string | undefined {
  for (const node of nodes) {
    if (node.name?.toLowerCase() === "title") {
      const title = normalizeText(htmlText(node));
      if (title) return Array.from(title).slice(0, defaultMaxDocumentTitleChars).join("");
    }
    const childTitle = htmlDocumentTitle(node.children ?? []);
    if (childTitle) return childTitle;
  }
  return undefined;
}

function visitHtmlNode(node: HtmlNode, elements: ParseElementInput[], sectionPath: string[]): void {
  const name = node.name?.toLowerCase();

  if (name && ["script", "style", "noscript"].includes(name)) {
    return;
  }

  // The HTML document title is metadata, not body content. Emitting it as a parse element creates
  // a standalone ordinal-zero chunk and a second outline root whenever the body also has an h1.
  if (name === "title") {
    return;
  }

  const headingDepth = htmlHeadingDepth(name);

  if (headingDepth) {
    const text = normalizeText(htmlText(node));

    if (text) {
      sectionPath.length = Math.max(headingDepth - 1, 0);
      sectionPath[headingDepth - 1] = text;
      const compactPath = compactSectionPath(sectionPath);
      sectionPath.length = compactPath.length;
      sectionPath.splice(0, compactPath.length, ...compactPath);
      elements.push({
        metadata: { depth: headingDepth },
        sectionPath: compactPath,
        text,
        type: "heading",
      });
    }

    return;
  }

  if (name === "p") {
    pushTextElement(elements, "paragraph", htmlText(node), sectionPath);
    return;
  }

  if (name === "ul" || name === "ol") {
    pushTextElement(elements, "list", htmlListText(node), sectionPath);
    return;
  }

  if (name === "pre" || name === "code") {
    pushTextElement(elements, "code", htmlText(node), sectionPath);
    return;
  }

  if (name === "table") {
    const projection = htmlTableProjection(node);
    pushTextElement(elements, "table", projection.text, sectionPath, {
      table: projection.metadata,
    });
    return;
  }

  if (name === "figure") {
    const image = firstHtmlImage(node);
    if (image) {
      const caption = normalizeText(
        findHtmlElements(node, "figcaption")
          .map((captionNode) => htmlText(captionNode))
          .join(" "),
      );
      pushHtmlImageElement(elements, image, sectionPath, caption || undefined, "html-figure");
      return;
    }
  }

  if (name === "img") {
    pushHtmlImageElement(elements, node, sectionPath, undefined, "html-img");
    return;
  }

  for (const child of node.children ?? []) {
    visitHtmlNode(child, elements, sectionPath);
  }
}

function unstructuredElementsToElements(
  sourceElements: readonly z.infer<typeof UnstructuredElementSchema>[],
): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];
  const headingPathsByElementId = new Map<string, string[]>();

  for (const sourceElement of sourceElements) {
    const type = unstructuredType(sourceElement.type);
    const tableProjection =
      type === "table" ? unstructuredTableProjection(sourceElement.metadata) : undefined;
    const text = tableProjection?.text ?? normalizeText(sourceElement.text ?? "");

    if (!text && !hasUnstructuredVisualMetadata(sourceElement.metadata, type)) {
      continue;
    }

    const pageNumber = sourceElement.metadata.page_number;

    if (text && (type === "title" || type === "heading")) {
      const parentId = metadataString(sourceElement.metadata, "parent_id");
      const parentPath = parentId ? headingPathsByElementId.get(parentId) : undefined;
      const categoryDepth = unstructuredCategoryDepth(sourceElement.metadata);
      const depthPath =
        categoryDepth !== undefined && categoryDepth <= sectionPath.length
          ? [...sectionPath.slice(0, categoryDepth), text]
          : undefined;
      const nextPath = parentPath ? [...parentPath, text] : (depthPath ?? [text]);
      sectionPath.splice(0, sectionPath.length, ...nextPath);

      if (sourceElement.element_id) {
        headingPathsByElementId.set(sourceElement.element_id, [...sectionPath]);
      }
    }

    elements.push({
      metadata: unstructuredParseElementMetadata({
        metadata: sourceElement.metadata,
        tableProjection,
        text,
        type,
        unstructuredType: sourceElement.type,
      }),
      ...(pageNumber ? { pageNumber } : {}),
      sectionPath: [...sectionPath],
      ...(text ? { text } : {}),
      type,
    });
  }

  return elements;
}

function unstructuredCategoryDepth(
  metadata: Readonly<Record<string, unknown>>,
): number | undefined {
  const depth = numericValue(metadata.category_depth);

  return depth !== undefined && Number.isInteger(depth) && depth >= 0 ? depth : undefined;
}

type UnstructuredSourceElement = z.infer<typeof UnstructuredElementSchema>;

interface UnstructuredLayoutBox {
  readonly bottom: number;
  readonly height: number;
  readonly layoutHeight?: number;
  readonly layoutWidth?: number;
  readonly right: number;
  readonly system?: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface UnstructuredVerticalGlyph {
  readonly box: UnstructuredLayoutBox;
  readonly element: UnstructuredSourceElement;
  readonly index: number;
  readonly pageNumber: number;
  readonly text: string;
}

function normalizeUnstructuredLayout(
  sourceElements: readonly UnstructuredSourceElement[],
): UnstructuredSourceElement[] {
  const pagesWithCjkText = new Set(
    sourceElements
      .filter((element) => containsCjkText(normalizeText(element.text ?? "")))
      .map((element) => element.metadata.page_number ?? 0),
  );
  const verticallyNormalized = mergeUnstructuredVerticalText(sourceElements);

  return verticallyNormalized.filter(
    (element) => !isUnstructuredLayoutNoise(element, pagesWithCjkText),
  );
}

function mergeUnstructuredVerticalText(
  sourceElements: readonly UnstructuredSourceElement[],
): UnstructuredSourceElement[] {
  const glyphs = sourceElements
    .map((element, index): UnstructuredVerticalGlyph | null => {
      const text = normalizeText(element.text ?? "");
      const pageNumber = element.metadata.page_number;
      const box = unstructuredLayoutBox(element.metadata.coordinates);

      if (
        pageNumber === undefined ||
        element.type?.toLowerCase() !== "uncategorizedtext" ||
        !isSingleCjkCharacter(text) ||
        !box
      ) {
        return null;
      }

      return { box, element, index, pageNumber, text };
    })
    .filter((glyph): glyph is UnstructuredVerticalGlyph => glyph !== null)
    .sort(compareUnstructuredVerticalGlyphs);
  const availableIndexes = new Set(glyphs.map((glyph) => glyph.index));
  const mergedByIndex = new Map<number, UnstructuredSourceElement>();
  const removedIndexes = new Set<number>();

  for (const first of glyphs) {
    if (!availableIndexes.delete(first.index)) {
      continue;
    }

    const group = [first];
    let current = first;

    while (true) {
      const next = glyphs
        .filter(
          (candidate) =>
            availableIndexes.has(candidate.index) &&
            unstructuredVerticalGlyphsAreAdjacent(current, candidate),
        )
        .sort(
          (left, right) =>
            verticalGlyphDistance(current, left) - verticalGlyphDistance(current, right),
        )[0];

      if (!next) {
        break;
      }

      availableIndexes.delete(next.index);
      group.push(next);
      current = next;
    }

    const mergedBox = unionUnstructuredLayoutBoxes(group.map((glyph) => glyph.box));

    if (
      group.length < 2 ||
      !mergedBox ||
      mergedBox.height <= Math.max(mergedBox.width * 1.5, first.box.height * 1.5)
    ) {
      continue;
    }

    const anchorIndex = Math.min(...group.map((glyph) => glyph.index));
    const topGlyph = [...group].sort(
      (left, right) => left.box.y - right.box.y || left.box.x - right.box.x,
    )[0];

    if (!topGlyph) {
      continue;
    }

    mergedByIndex.set(anchorIndex, {
      ...topGlyph.element,
      metadata: {
        ...cloneMetadata(topGlyph.element.metadata),
        coordinates: mergedUnstructuredCoordinates(
          topGlyph.element.metadata.coordinates,
          mergedBox,
        ),
        layout_normalization: {
          operation: "merge_vertical_text",
          source_element_count: group.length,
        },
      },
      text: group
        .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x)
        .map((glyph) => glyph.text)
        .join(""),
    });

    for (const glyph of group) {
      if (glyph.index !== anchorIndex) {
        removedIndexes.add(glyph.index);
      }
    }
  }

  return sourceElements.flatMap((element, index) => {
    const merged = mergedByIndex.get(index);

    if (merged) {
      return [merged];
    }

    return removedIndexes.has(index) ? [] : [element];
  });
}

function compareUnstructuredVerticalGlyphs(
  left: UnstructuredVerticalGlyph,
  right: UnstructuredVerticalGlyph,
): number {
  return (
    left.pageNumber - right.pageNumber ||
    left.box.x + left.box.width / 2 - (right.box.x + right.box.width / 2) ||
    left.box.y - right.box.y ||
    left.index - right.index
  );
}

function unstructuredVerticalGlyphsAreAdjacent(
  upper: UnstructuredVerticalGlyph,
  lower: UnstructuredVerticalGlyph,
): boolean {
  if (
    upper.pageNumber !== lower.pageNumber ||
    (upper.box.system && lower.box.system && upper.box.system !== lower.box.system)
  ) {
    return false;
  }

  const upperCenterX = upper.box.x + upper.box.width / 2;
  const lowerCenterX = lower.box.x + lower.box.width / 2;
  const horizontalTolerance = Math.max(
    2,
    Math.max(upper.box.width, lower.box.width) * 0.35,
    Math.max(upper.box.layoutWidth ?? 0, lower.box.layoutWidth ?? 0) * 0.002,
  );
  const verticalGap = lower.box.y - upper.box.bottom;
  const glyphHeight = Math.max(upper.box.height, lower.box.height);

  return (
    lower.box.y + lower.box.height / 2 > upper.box.y + upper.box.height / 2 &&
    Math.abs(upperCenterX - lowerCenterX) <= horizontalTolerance &&
    verticalGap >= -glyphHeight * 0.25 &&
    verticalGap <= glyphHeight * 1.1
  );
}

function verticalGlyphDistance(
  upper: UnstructuredVerticalGlyph,
  lower: UnstructuredVerticalGlyph,
): number {
  const horizontalDistance = Math.abs(
    upper.box.x + upper.box.width / 2 - (lower.box.x + lower.box.width / 2),
  );
  const verticalGap = Math.max(lower.box.y - upper.box.bottom, 0);

  return verticalGap * 2 + horizontalDistance;
}

function unionUnstructuredLayoutBoxes(
  boxes: readonly UnstructuredLayoutBox[],
): UnstructuredLayoutBox | undefined {
  const first = boxes[0];

  if (!first) {
    return undefined;
  }

  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));

  return {
    bottom,
    height: bottom - y,
    ...(first.layoutHeight === undefined ? {} : { layoutHeight: first.layoutHeight }),
    ...(first.layoutWidth === undefined ? {} : { layoutWidth: first.layoutWidth }),
    right,
    ...(first.system === undefined ? {} : { system: first.system }),
    width: right - x,
    x,
    y,
  };
}

function mergedUnstructuredCoordinates(
  coordinates: unknown,
  box: UnstructuredLayoutBox,
): Record<string, unknown> {
  return {
    ...(isPlainRecord(coordinates) ? cloneMetadata(coordinates) : {}),
    points: [
      [box.x, box.y],
      [box.x, box.bottom],
      [box.right, box.bottom],
      [box.right, box.y],
    ],
  };
}

function isUnstructuredLayoutNoise(
  element: UnstructuredSourceElement,
  pagesWithCjkText: ReadonlySet<number>,
): boolean {
  if (element.type?.toLowerCase() !== "uncategorizedtext") {
    return false;
  }

  const text = normalizeText(element.text ?? "");
  const box = unstructuredLayoutBox(element.metadata.coordinates);

  if (!text || !box) {
    return false;
  }

  if (unstructuredBoxIsOutsideLayout(box)) {
    return true;
  }

  if (!pagesWithCjkText.has(element.metadata.page_number ?? 0)) {
    return false;
  }

  const compactText = text.replace(/\s+/gu, "");
  const codePointCount = Array.from(compactText).length;
  const hasSuspiciousDelimiter =
    /[|¦]/u.test(compactText) || hasUnmatchedClosingDelimiter(compactText);

  return (
    codePointCount > 0 &&
    codePointCount <= 6 &&
    !containsCjkText(compactText) &&
    !/\d/u.test(compactText) &&
    /[A-Za-z]/u.test(compactText) &&
    hasSuspiciousDelimiter &&
    box.height > box.width
  );
}

function unstructuredBoxIsOutsideLayout(box: UnstructuredLayoutBox): boolean {
  if (
    box.layoutWidth === undefined ||
    box.layoutHeight === undefined ||
    box.layoutWidth <= 0 ||
    box.layoutHeight <= 0
  ) {
    return false;
  }

  const horizontalTolerance = box.layoutWidth * 0.01;
  const verticalTolerance = box.layoutHeight * 0.01;

  return (
    box.x < -horizontalTolerance ||
    box.y < -verticalTolerance ||
    box.right > box.layoutWidth + horizontalTolerance ||
    box.bottom > box.layoutHeight + verticalTolerance
  );
}

function hasUnmatchedClosingDelimiter(text: string): boolean {
  const delimiterPairs = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const;

  return delimiterPairs.some(
    ([opening, closing]) => text.includes(closing) && !text.includes(opening),
  );
}

function containsCjkText(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text);
}

function isSingleCjkCharacter(text: string): boolean {
  return Array.from(text).length === 1 && containsCjkText(text);
}

function hasUnstructuredVisualMetadata(
  metadata: Readonly<Record<string, unknown>>,
  type: ParseElement["type"],
): boolean {
  return (
    type === "image" ||
    type === "table" ||
    type === "page-break" ||
    Boolean(
      metadataString(metadata, "image_path") ??
        metadataString(metadata, "image_url") ??
        metadataString(metadata, "url") ??
        metadataString(metadata, "text_as_html"),
    ) ||
    isPlainRecord(metadata.coordinates)
  );
}

function unstructuredParseElementMetadata({
  metadata,
  tableProjection,
  text,
  type,
  unstructuredType,
}: {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tableProjection?: TableProjection | undefined;
  readonly text: string;
  readonly type: ParseElement["type"];
  readonly unstructuredType: string | undefined;
}): Record<string, unknown> {
  // `image_base64` can be several megabytes. Move it into the short-lived assetRef URI consumed
  // by the multimodal extractor instead of retaining a second copy in ParseElement metadata.
  // `text_as_html` is normalized below. Keeping the provider spelling as well would retain the
  // same potentially multi-megabyte table HTML three times (`text_as_html`, `textAsHtml`, and
  // `table.html`) in every parse artifact.
  const {
    image_base64: _imageBase64,
    page_number: _pageNumber,
    text_as_html: _textAsHtml,
    ...metadataWithoutInlineImage
  } = metadata;
  const parsed = cloneMetadata(metadataWithoutInlineImage);
  const assetRef = unstructuredAssetRef(metadata);
  const boundingBox = unstructuredBoundingBox(metadata.coordinates);
  const textAsHtml = metadataString(metadata, "text_as_html");
  const caption = metadataString(metadata, "caption") ?? metadataString(metadata, "alt_text");
  const title = metadataString(metadata, "title");
  const enriched = {
    ...(assetRef ? { assetRef } : {}),
    ...(boundingBox ? { boundingBox } : {}),
    ...(caption ? { caption } : {}),
    ...(type === "image" && text ? { ocrText: text } : {}),
    ...(textAsHtml ? { textAsHtml } : {}),
    ...(type === "table" && (textAsHtml || tableProjection)
      ? {
          table: {
            ...(tableProjection?.metadata ?? {}),
            ...(textAsHtml ? { html: textAsHtml } : {}),
          },
        }
      : {}),
    ...(title ? { title } : {}),
  };

  return {
    ...parsed,
    ...enriched,
    ...(unstructuredType && (Object.keys(parsed).length > 0 || Object.keys(enriched).length > 0)
      ? { unstructuredType }
      : {}),
  };
}

function unstructuredTableProjection(
  metadata: Readonly<Record<string, unknown>>,
): TableProjection | undefined {
  const textAsHtml = metadataString(metadata, "text_as_html");
  if (!textAsHtml) return undefined;
  const document = parseDocument(textAsHtml, {
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
  });
  const table = (document.children as HtmlNode[]).flatMap((node) =>
    node.name?.toLowerCase() === "table" ? [node] : findHtmlElements(node, "table"),
  )[0];
  return table ? htmlTableProjection(table) : undefined;
}

function unstructuredAssetRef(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const contentType = normalizedImageContentType(metadataString(metadata, "image_mime_type"));
  const imageBase64 = metadataString(metadata, "image_base64")?.replaceAll(/\s+/gu, "");
  const embeddedUri =
    contentType && imageBase64 ? `data:${contentType};base64,${imageBase64}` : undefined;
  const uri =
    embeddedUri ??
    metadataString(metadata, "image_path") ??
    metadataString(metadata, "image_url") ??
    metadataString(metadata, "url");

  if (!uri) {
    return undefined;
  }

  return {
    ...(contentType ? { contentType } : {}),
    uri,
  };
}

function normalizedImageContentType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();

  return normalized && /^image\/[a-z0-9.+-]+$/u.test(normalized) ? normalized : undefined;
}

function unstructuredBoundingBox(value: unknown): Record<string, number> | undefined {
  const box = unstructuredLayoutBox(value);

  if (!box) {
    return undefined;
  }

  return {
    height: box.height,
    width: box.width,
    x: box.x,
    y: box.y,
  };
}

function unstructuredLayoutBox(value: unknown): UnstructuredLayoutBox | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const points = value.points;

  if (!Array.isArray(points)) {
    return undefined;
  }

  const coordinates = points
    .map((point) => {
      if (!Array.isArray(point)) {
        return null;
      }

      const x = numericValue(point[0]);
      const y = numericValue(point[1]);

      return x === undefined || y === undefined ? null : { x, y };
    })
    .filter((point): point is { readonly x: number; readonly y: number } => point !== null);

  if (coordinates.length === 0) {
    return undefined;
  }

  const xs = coordinates.map((point) => point.x);
  const ys = coordinates.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const layoutWidth = numericValue(value.layout_width);
  const layoutHeight = numericValue(value.layout_height);
  const system = metadataString(value, "system");

  return {
    bottom: maxY,
    height: maxY - minY,
    ...(layoutHeight === undefined ? {} : { layoutHeight }),
    ...(layoutWidth === undefined ? {} : { layoutWidth }),
    right: maxX,
    ...(system === undefined ? {} : { system }),
    width: maxX - minX,
    x: minX,
    y: minY,
  };
}

function unstructuredType(type: string | undefined): ParseElement["type"] {
  const normalized = type?.toLowerCase() ?? "";

  if (normalized.includes("title")) {
    return "title";
  }

  if (normalized.includes("heading")) {
    return "heading";
  }

  if (normalized.includes("table")) {
    return "table";
  }

  if (normalized.includes("list")) {
    return "list";
  }

  if (normalized.includes("image")) {
    return "image";
  }

  if (normalized.includes("code")) {
    return "code";
  }

  if (normalized.includes("pagebreak") || normalized.includes("page break")) {
    return "page-break";
  }

  return "paragraph";
}

function pushTextElement(
  elements: ParseElementInput[],
  type: ParseElement["type"],
  rawText: string,
  sectionPath: readonly string[],
  metadata: Readonly<Record<string, unknown>> = {},
): void {
  const text = normalizeText(rawText);

  if (!text) {
    return;
  }

  elements.push({
    metadata: cloneMetadata(metadata),
    sectionPath: compactSectionPath(sectionPath),
    text,
    type,
  });
}

function pushImageElement(
  elements: ParseElementInput[],
  sectionPath: readonly string[],
  metadata: Readonly<Record<string, unknown>>,
  text = metadataString(metadata, "caption") ?? metadataString(metadata, "title"),
): void {
  elements.push({
    metadata: cloneMetadata(metadata),
    sectionPath: compactSectionPath(sectionPath),
    ...(text ? { text } : {}),
    type: "image",
  });
}

function compactSectionPath(sectionPath: readonly (string | undefined)[]): string[] {
  return sectionPath.filter((segment): segment is string => typeof segment === "string");
}

function markdownTableProjection(table: Tokens.Table): TableProjection {
  return projectTableRecords({
    columns: table.header.map((cell) => normalizeText(cell.text)),
    headerRowCount: 1,
    rows: table.rows.map((row) => row.map((cell) => normalizeText(cell.text))),
  });
}

function htmlListText(node: HtmlNode): string {
  return (node.children ?? [])
    .filter((child) => child.name?.toLowerCase() === "li")
    .map((child) => normalizeText(htmlText(child)))
    .filter(Boolean)
    .join("\n");
}

function htmlTableProjection(node: HtmlNode): TableProjection {
  const rows = htmlTableRows(node);
  if (rows.length === 0) {
    return {
      metadata: {
        columns: [],
        headerRowCount: 0,
        mode: "unknown",
        recordCount: 0,
        semanticVersion: 1,
        sourceRowCount: 0,
      },
      text: "",
    };
  }
  const firstRow = rows[0] as {
    readonly cells: readonly string[];
    readonly hasHeaderCell: boolean;
    readonly inHeaderGroup: boolean;
  };
  if (firstRow.hasHeaderCell || firstRow.inHeaderGroup) {
    const headerRowCount = rows.findIndex((row) => !row.hasHeaderCell && !row.inHeaderGroup);
    const resolvedHeaderRowCount = headerRowCount === -1 ? rows.length : headerRowCount;
    return projectTableRecords({
      columns: flattenHtmlTableHeaders(rows.slice(0, resolvedHeaderRowCount)),
      headerRowCount: resolvedHeaderRowCount,
      rows: rows.slice(resolvedHeaderRowCount).map((row) => row.cells),
      sourceRowCount: rows.length,
    });
  }
  return projectHeaderlessTableRows(rows.map((row) => row.cells));
}

function htmlTableRows(node: HtmlNode): Array<{
  readonly cells: readonly string[];
  readonly hasHeaderCell: boolean;
  readonly inHeaderGroup: boolean;
}> {
  const headerRows = new Set(
    findHtmlElements(node, "thead").flatMap((header) => findHtmlElements(header, "tr")),
  );
  let activeRowspans = new Map<number, { readonly remaining: number; readonly value: string }>();
  return findHtmlElements(node, "tr")
    .map((row) => {
      const sourceCells = (row.children ?? []).filter((cell) =>
        ["td", "th"].includes(cell.name?.toLowerCase() ?? ""),
      );
      const cells: string[] = [];
      const nextRowspans = new Map<
        number,
        { readonly remaining: number; readonly value: string }
      >();
      let column = 0;
      const consumeRowspan = () => {
        const carried = activeRowspans.get(column);
        if (!carried) return false;
        cells[column] = carried.value;
        if (carried.remaining > 1) {
          nextRowspans.set(column, { remaining: carried.remaining - 1, value: carried.value });
        }
        activeRowspans.delete(column);
        column += 1;
        return true;
      };
      for (const cell of sourceCells) {
        while (consumeRowspan()) {
          // A rowspan reserves this column before the next source cell.
        }
        const value = normalizeText(htmlText(cell));
        const columnSpan = htmlTableCellSpan(cell, "colspan");
        const rowSpan = htmlTableCellSpan(cell, "rowspan");
        for (let offset = 0; offset < columnSpan; offset += 1) {
          while (consumeRowspan()) {
            // A colspan only occupies columns not already reserved by a rowspan.
          }
          cells[column] = value;
          if (rowSpan > 1) {
            nextRowspans.set(column, { remaining: rowSpan - 1, value });
          }
          column += 1;
        }
      }
      while (activeRowspans.size > 0) {
        if (!consumeRowspan()) column += 1;
      }
      activeRowspans = nextRowspans;
      return {
        cells,
        hasHeaderCell: sourceCells.some((cell) => cell.name?.toLowerCase() === "th"),
        inHeaderGroup: headerRows.has(row),
      };
    })
    .filter((row) => row.cells.some(Boolean));
}

function flattenHtmlTableHeaders(rows: readonly { readonly cells: readonly string[] }[]): string[] {
  const width = Math.max(...rows.map((row) => row.cells.length), 1);
  return Array.from({ length: width }, (_, column) => {
    const labels: string[] = [];
    for (const row of rows) {
      const label = row.cells[column]?.trim();
      if (label && labels.at(-1) !== label) labels.push(label);
    }
    return labels.join(" / ");
  });
}

function htmlTableCellSpan(cell: HtmlNode, attribute: "colspan" | "rowspan"): number {
  const parsed = Number.parseInt(cell.attribs?.[attribute] ?? "1", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 256 ? parsed : 1;
}

function projectHeaderlessTableRows(rows: readonly (readonly string[])[]): TableProjection {
  if (rows.length === 1) {
    return projectTableRecords({ columns: [], headerRowCount: 0, rows });
  }
  const firstRow = rows[0] ?? [];
  if (looksLikeTableHeader(firstRow, rows.slice(1))) {
    return projectTableRecords({
      columns: firstRow,
      headerRowCount: 1,
      rows: rows.slice(1),
    });
  }
  if (looksLikeKeyValueTable(rows)) {
    return projectTableRecords({
      columns: rows.map((row) => row[0] ?? ""),
      headerRowCount: 0,
      mode: "single-record",
      rows: [rows.map((row) => row[1] ?? "")],
      sourceRowCount: rows.length,
    });
  }
  return projectTableRecords({
    columns: Array.from(
      { length: Math.max(...rows.map((row) => row.length), 1) },
      (_, index) => `column_${index + 1}`,
    ),
    headerRowCount: 0,
    mode: "record-list",
    rows,
  });
}

const TABLE_HEADER_LABEL_PATTERN =
  /(?:^|[_\s-])(id|key|name|title|date|time|status|type|category|description|detail|score|count|amount|price|value|result)(?:$|[_\s-])|(?:编号|号码|代码|名称|姓名|标题|日期|时间|状态|类型|类别|问题|描述|详情|等级|是否|结果|分数|数量|金额|价格|解决|办法|地区|季度|备注)/iu;

function looksLikeTableHeader(
  firstRow: readonly string[],
  remainingRows: readonly (readonly string[])[],
): boolean {
  if (firstRow.length < 2) return false;
  const populated = firstRow.filter((cell) => cell.trim());
  const labelCount = populated.filter((cell) =>
    TABLE_HEADER_LABEL_PATTERN.test(cell.trim()),
  ).length;
  if (labelCount >= Math.min(2, populated.length)) return true;

  let typedColumns = 0;
  for (let index = 0; index < firstRow.length; index += 1) {
    const header = firstRow[index]?.trim() ?? "";
    if (!header || tableCellValueKind(header) !== "text") continue;
    const values = remainingRows
      .map((row) => row[index]?.trim() ?? "")
      .filter(Boolean)
      .map(tableCellValueKind);
    if (
      values.length > 0 &&
      values.filter((kind) => kind !== "text").length / values.length >= 0.7
    ) {
      typedColumns += 1;
    }
  }
  return typedColumns > 0;
}

function looksLikeKeyValueTable(rows: readonly (readonly string[])[]): boolean {
  if (!rows.every((row) => row.length === 2)) return false;
  const labels = rows.map((row) => row[0]?.trim() ?? "");
  if (labels.some((label) => !label) || new Set(labels).size !== labels.length) return false;
  const recognized = labels.filter((label) => TABLE_HEADER_LABEL_PATTERN.test(label)).length;
  return recognized / labels.length >= 0.6;
}

function tableCellValueKind(value: string): "boolean" | "date" | "number" | "text" {
  const normalized = value.trim();
  if (/^(?:true|false|yes|no|是|否)$/iu.test(normalized)) return "boolean";
  if (/^\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?(?:\s|$)/u.test(normalized)) return "date";
  if (Number.isFinite(Number(normalized.replaceAll(",", "").replace(/[%￥¥$]/gu, "")))) {
    return "number";
  }
  return "text";
}

function markdownImagesFromToken(token: Token): MarkdownImageRef[] {
  const candidate = token as Token & {
    readonly href?: unknown;
    readonly text?: unknown;
    readonly title?: unknown;
    readonly tokens?: readonly Token[];
  };
  const images: MarkdownImageRef[] = [];

  if (candidate.type === "image" && typeof candidate.href === "string" && candidate.href.trim()) {
    const uri = candidate.href.trim();
    const alt = typeof candidate.text === "string" ? normalizeText(candidate.text) : "";
    const title = typeof candidate.title === "string" ? normalizeText(candidate.title) : "";

    images.push({
      ...(alt ? { alt } : {}),
      ...(title ? { title } : {}),
      ...(inferImageContentTypeFromUri(uri)
        ? { contentType: inferImageContentTypeFromUri(uri) }
        : {}),
      uri,
    });
  }

  for (const child of candidate.tokens ?? []) {
    images.push(...markdownImagesFromToken(child));
  }

  return images;
}

function firstHtmlImage(node: HtmlNode): HtmlNode | undefined {
  if (node.name?.toLowerCase() === "img") {
    return node;
  }

  for (const child of node.children ?? []) {
    const image = firstHtmlImage(child);
    if (image) {
      return image;
    }
  }

  return undefined;
}

function pushHtmlImageElement(
  elements: ParseElementInput[],
  node: HtmlNode,
  sectionPath: readonly string[],
  captionOverride: string | undefined,
  source: "html-figure" | "html-img",
): void {
  const uri = htmlAttribute(node, "src");
  if (!uri) {
    return;
  }

  const alt = htmlAttribute(node, "alt");
  const title = htmlAttribute(node, "title");
  const caption = captionOverride ?? alt ?? title;
  const contentType = inferImageContentTypeFromUri(uri);

  pushImageElement(elements, sectionPath, {
    ...(alt ? { alt } : {}),
    assetRef: {
      ...(contentType ? { contentType } : {}),
      uri,
    },
    ...(caption ? { caption } : {}),
    source,
    ...(title ? { title } : {}),
  });
}

function htmlAttribute(node: HtmlNode, name: string): string | undefined {
  const value = node.attribs?.[name];

  return value?.trim() ? value.trim() : undefined;
}

function inferImageContentTypeFromUri(uri: string): string | undefined {
  const dataUriMatch = uri.match(/^data:([^;,]+)[;,]/i);
  if (dataUriMatch?.[1]?.toLowerCase().startsWith("image/")) {
    return dataUriMatch[1].toLowerCase();
  }

  const path = uri.split(/[?#]/u)[0]?.toLowerCase() ?? "";

  if (path.endsWith(".png")) {
    return "image/png";
  }
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (path.endsWith(".gif")) {
    return "image/gif";
  }
  if (path.endsWith(".webp")) {
    return "image/webp";
  }
  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (path.endsWith(".avif")) {
    return "image/avif";
  }
  if (path.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (path.endsWith(".tif") || path.endsWith(".tiff")) {
    return "image/tiff";
  }

  return undefined;
}

function findHtmlElements(node: HtmlNode, name: string): HtmlNode[] {
  const matches: HtmlNode[] = [];

  if (node.name?.toLowerCase() === name) {
    matches.push(node);
  }

  for (const child of node.children ?? []) {
    matches.push(...findHtmlElements(child, name));
  }

  return matches;
}

function htmlText(node: HtmlNode): string {
  return DomUtils.textContent(node as never);
}

function htmlHeadingDepth(name: string | undefined): number | null {
  const match = name?.match(/^h([1-6])$/);

  return match?.[1] ? Number(match[1]) : null;
}

function inferContentType(elements: readonly ParseElement[]): ParseArtifact["contentType"] {
  if (
    elements.length > 0 &&
    elements.every((element) => typeof element.metadata.format === "string")
  ) {
    return "structured";
  }

  if (elements.some((element) => ["code", "image", "list", "table"].includes(element.type))) {
    return "mixed";
  }

  return "text";
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function normalizeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeTableCell(text: string): string {
  return normalizeText(text).replace(/\n+/gu, " ");
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cloneMetadata(metadata: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function assertInputBounds(body: Uint8Array, maxInputBytes: number): void {
  if (maxInputBytes < 1) {
    throw new ProviderInputError("Parser maxInputBytes must be at least 1");
  }

  if (body.byteLength > maxInputBytes) {
    throw new ProviderInputError(`Parser input exceeds maxInputBytes=${maxInputBytes}`);
  }
}

async function artifactHash(
  parserVersion: string,
  body: Uint8Array,
  context?: string,
): Promise<string> {
  const prefix = new TextEncoder().encode(
    context === undefined ? `${parserVersion}\n` : `${parserVersion}\n${context}\n`,
  );
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength);
  bytes.set(prefix, 0);
  bytes.set(body, prefix.byteLength);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function boundedResponseText(response: Response, maxResponseBytes: number): Promise<string> {
  if (maxResponseBytes < 1) {
    throw new ProviderInputError("Unstructured parser maxResponseBytes must be at least 1");
  }

  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > maxResponseBytes) {
    await cancelResponseBody(response.body);
    throw new ProviderResponseError(
      `Unstructured parser response exceeds maxResponseBytes=${maxResponseBytes}`,
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await cancelResponseReader(reader);
        throw new ProviderResponseError(
          `Unstructured parser response exceeds maxResponseBytes=${maxResponseBytes}`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return decodeUtf8(body);
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) {
    return;
  }

  try {
    await body.cancel();
  } catch {
    // Preserve the bounded-response error even when the transport rejects cancellation.
  }
}

async function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the bounded-response error even when the transport rejects cancellation.
  }
}

async function fetchWithRetries({
  buildRequest,
  fetchImpl,
  maxRetries,
  retryDelayMs,
  signal,
  sleep,
}: {
  readonly buildRequest: () => Request;
  readonly fetchImpl: typeof fetch;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly signal: AbortSignal;
  readonly sleep: (ms: number) => Promise<void>;
}): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetchImpl(buildRequest());
    } catch (error) {
      if (signal.aborted) {
        throw abortSignalReason(signal);
      }
      if (attempt >= maxRetries) {
        throw new ProviderRequestError("Unstructured parser request failed", {
          cause: error,
          retryable: true,
        });
      }
      await sleepWithAbort(sleep, retryDelayMs, signal);
      continue;
    }

    if (!isRetryableProviderStatus(response.status) || attempt >= maxRetries) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    await sleepWithAbort(sleep, retryDelayMs, signal);
  }
}

async function sleepWithAbort(
  sleep: (ms: number) => Promise<void>,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (delayMs === 0) {
    return;
  }

  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      sleep(delayMs),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortSignalReason(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function validateRetryOptions({
  maxRetries,
  retryDelayMs,
}: {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}): void {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new ProviderInputError("Unstructured parser maxRetries must be a non-negative integer");
  }

  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new ProviderInputError("Unstructured parser retryDelayMs must be a non-negative integer");
  }
}

function validateUnstructuredResourceOptions({
  maxConcurrency,
  requestTimeoutMs,
}: {
  readonly maxConcurrency: number;
  readonly requestTimeoutMs: number;
}): void {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
    throw new ProviderInputError(
      "Unstructured parser maxConcurrency must be an integer between 1 and 32",
    );
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 600_000
  ) {
    throw new ProviderInputError(
      "Unstructured parser requestTimeoutMs must be an integer between 1 and 600000",
    );
  }
}

interface AbortAwareConcurrencyGate {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

function createAbortAwareConcurrencyGate(limit: number): AbortAwareConcurrencyGate {
  let active = 0;
  const waiters: Array<{
    readonly cleanup: () => void;
    readonly reject: (error: unknown) => void;
    readonly resolve: () => void;
    readonly signal?: AbortSignal;
  }> = [];

  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      throw abortSignalReason(signal);
    }
    if (active < limit) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const waiter = {
        cleanup: () => {
          if (onAbort) signal?.removeEventListener("abort", onAbort);
        },
        reject,
        resolve,
        ...(signal ? { signal } : {}),
      };
      onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
          waiter.cleanup();
          reject(abortSignalReason(signal as AbortSignal));
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push(waiter);
      if (signal?.aborted) {
        onAbort();
      }
    });
  };

  const release = (): void => {
    while (true) {
      const next = waiters.shift();
      if (!next) {
        active -= 1;
        return;
      }
      if (next.signal?.aborted) {
        next.cleanup();
        next.reject(abortSignalReason(next.signal));
        continue;
      }
      next.cleanup();
      next.resolve();
      return;
    }
  };

  return {
    run: async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
      await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

interface UnstructuredRequestDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
  expired(): boolean;
  throwIfExpired(): void;
}

function createUnstructuredRequestDeadline(
  externalSignal: AbortSignal | undefined,
  requestTimeoutMs: number,
): UnstructuredRequestDeadline {
  const controller = new AbortController();
  const timeoutReason = new Error("Unstructured parser request deadline exceeded");
  let expired = false;
  const onExternalAbort = () => controller.abort(abortSignalReason(externalSignal as AbortSignal));
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) {
    onExternalAbort();
  }
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      expired = true;
      controller.abort(timeoutReason);
    }
  }, requestTimeoutMs);
  (timer as { unref?: () => void }).unref?.();

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
    expired: () => expired,
    throwIfExpired: () => {
      if (expired) {
        throw timeoutReason;
      }
    },
  };
}

function abortSignalReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new DOMException("The operation was aborted", "AbortError");
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function providerRequestError(label: string, status: number): ProviderError {
  const message = `${label} request failed with status ${status}`;

  if (status === 429) {
    return new ProviderRateLimitError(message, { status });
  }

  return new ProviderRequestError(message, { status });
}

async function sleepMs(ms: number): Promise<void> {
  if (ms === 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}
