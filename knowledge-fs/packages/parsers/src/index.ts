import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

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

import { resolveDocumentFormat } from "./document-format-registry";
import { OfficeArchiveAdmissionError, assertOfficeArchiveSafe } from "./office-parser-preflight";
import { createArchiveMediaReportCollector } from "./parse-coverage";
export {
  DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION,
  documentExtension,
  documentMimeTypesForFilename,
  resolveDocumentFormat,
} from "./document-format-registry";
import {
  ParserResourceLimitError,
  assertParserResourceBudget,
  parserResourceLimits,
} from "./parser-resource-budget";
import {
  documentJsonRootType,
  isDocumentRecord,
  parseDocumentJson,
  stringifyDocumentJson,
} from "./structured-json";
import { assertXmlStructureBudget, iterateDocumentLines } from "./structured-stream-admission";
import { decodeDocumentText, propertiesElements, vttElements } from "./text-document-contracts";
import { createUnstructuredGlyphIndex } from "./unstructured-glyph-index";
import {
  maxUnstructuredSectionDepth,
  maxUnstructuredSectionPathItems,
  maxUnstructuredVerticalCandidateComparisons,
} from "./unstructured-normalization-policy";
import { createUnstructuredRequestCoordinator } from "./unstructured-request-coordinator";
import { parseUnstructuredResponsePayload } from "./unstructured-response-budget";
import { classifyUnstructuredResourceResponse } from "./unstructured-sandbox-response";
import {
  type UnstructuredWorkloadClassification,
  classifyUnstructuredWorkload,
} from "./unstructured-workload-policy";

export {
  classifyKnownHeavyUnstructuredWorkload,
  classifyUnstructuredWorkload,
} from "./unstructured-workload-policy";

export type ParserKind = "native-html" | "native-markdown" | "native-structured" | "unstructured";
export type ParserWorkloadKind = "heavy" | "rejected" | "standard";

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
  /** Effective process-local heavy-lane width, when the parser owns such a lane. */
  readonly heavyWorkloadMaxConcurrency?: number;
  parse(input: ParseDocumentInput): Promise<ParseArtifact>;
  /**
   * Classifies already-loaded input for admission without starting parser/provider work. Routers
   * must forward this to the selected parser so callers can avoid holding a broad slot while a
   * heavy request waits on its narrow lane.
   */
  readonly workloadKind?: (input: ParseDocumentInput) => ParserWorkloadKind;
  /**
   * Minimum durable execution lease required before entering this parser's admission queue.
   * Native parsers omit it; remote parsers derive it from their effective transport deadline.
   */
  readonly leaseMs?: (input: ParseDocumentInput) => number | undefined;
  /**
   * Whether this request is expensive enough to persist its complete raw response for retry.
   *
   * This is deliberately independent from `policyFingerprint`: native parsers still expose a
   * stable identity for request coordination, but their cheap local output must not be duplicated
   * into the durable raw-checkpoint table.
   */
  readonly checkpointEligible?: (input: ParseDocumentInput) => boolean;
  /**
   * Stable parser-policy identity for checkpoints and in-flight request coalescing.
   *
   * The fingerprint describes configuration and routing, not caller cancellation or document
   * bytes. `documentAssetId` + `version` identify the immutable document body separately.
   */
  readonly policyFingerprint?: (input: ParseDocumentInput) => string | undefined;
}

export type ProviderErrorCode =
  | "document_parser_unsupported_type"
  | "provider_input"
  | "provider_rate_limited"
  | "provider_request_failed"
  | "provider_response_invalid"
  | "provider_timeout";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  /** The provider may still be processing after the local request stopped observing it. */
  readonly requestOutcomeAmbiguous: boolean;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    {
      cause,
      code,
      requestOutcomeAmbiguous = false,
      retryable = false,
      status,
    }: {
      readonly cause?: unknown;
      readonly code: ProviderErrorCode;
      readonly requestOutcomeAmbiguous?: boolean;
      readonly retryable?: boolean;
      readonly status?: number;
    },
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
    this.code = code;
    this.requestOutcomeAmbiguous = requestOutcomeAmbiguous;
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

/** The file is readable but its format is not one the configured parser can handle. */
export class ProviderUnsupportedFileTypeError extends ProviderError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, { ...options, code: "document_parser_unsupported_type", retryable: false });
    this.name = "ProviderUnsupportedFileTypeError";
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
      requestOutcomeAmbiguous: options.status === undefined,
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

export class ProviderTimeoutError extends ProviderError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, {
      ...options,
      code: "provider_timeout",
      requestOutcomeAmbiguous: true,
      retryable: false,
    });
    this.name = "ProviderTimeoutError";
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
  /** Deployment-owned semantic identity (pinned image + extraction policy), not transport limits. */
  readonly backendRevision?: string;
  readonly apiKey?: string;
  readonly defaultLanguage?: string;
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
  readonly maxResponseBytes?: number;
  /** Process-wide admission limit shared by every Unstructured request. */
  readonly maxConcurrency?: number;
  readonly maxRetries?: number;
  /** Nested admission limit for PDFs and structurally/byte-heavy remote documents. */
  readonly heavyMaxConcurrency?: number;
  /** Heavy-document transport deadline; ordinary documents retain `requestTimeoutMs`. */
  readonly heavyRequestTimeoutMs?: number;
  /** @deprecated Compatibility alias for `heavyMaxConcurrency`. */
  readonly pdfMaxConcurrency?: number;
  /** @deprecated Compatibility alias for `heavyRequestTimeoutMs`. */
  readonly pdfRequestTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  /** Platform-specific resource checks, inside admission and before any remote work starts. */
  readonly requestPreflight?: UnstructuredRequestPreflight;
  readonly retryDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface UnstructuredRequestPreflight {
  check(input: ParseDocumentInput): Promise<void>;
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
const defaultMaxArchiveMetadataBytes = 2 * 1024 * 1024;
const defaultMaxArchiveMetadataCount = 512;
const defaultMaxArchiveMetadataTotalBytes = 16 * 1024 * 1024;
const archivePathCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const canonicalTextEncoder = new TextEncoder();
const canonicalTextEdgeWhitespace = /^\p{White_Space}+|\p{White_Space}+$/gu;
// Image blocks are returned as base64 in the partition JSON. Keep the response bounded while
// leaving enough headroom for the encoded images of ordinary PDF, Office, and presentation files.
const defaultMaxResponseBytes = 32 * 1024 * 1024;
const defaultMaxConcurrency = 2;
const defaultMaxRetries = 0;
const defaultRequestTimeoutMs = 600_000;
const maxParserLeaseGraceMs = 300_000;
// The synchronous provider endpoint may legitimately need more than 30 minutes for a bounded
// heavy document. Keep the ordinary default at ten minutes, but allow a deployment up to one hour
// for a classified operation without disabling the deadline.
const maxRequestTimeoutMs = 3_600_000;
const defaultMaxRows = 20_000;
const defaultRetryDelayMs = 100;
const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();

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

function nativeParserPolicyFingerprint(
  input: ParseDocumentInput,
  kind: Exclude<ParserKind, "unstructured">,
  parserVersion: string,
  options: NativeParserOptions,
): string {
  return parserPolicyFingerprintHash(
    JSON.stringify({
      filename: input.filename,
      kind,
      maxElements: options.maxElements ?? defaultMaxElements,
      mimeType: normalizedMimeType(input.mimeType),
      parserVersion,
    }),
  );
}

function parserPolicyFingerprintHash(context: string): string {
  return createHash("sha256").update(context).digest("hex");
}

export function createNativeMarkdownParser(options: NativeParserOptions = {}): ParserAdapter {
  const policyFingerprint = (input: ParseDocumentInput): string => {
    const parserVersion =
      options.parserVersion ?? (isMdxInput(input) ? "native-mdx@4" : "native-markdown@4");
    return nativeParserPolicyFingerprint(input, "native-markdown", parserVersion, options);
  };

  return {
    kind: "native-markdown",
    policyFingerprint,
    parse: async (input) => {
      input.signal?.throwIfAborted();
      const isMdx = isMdxInput(input);
      const parserVersion = options.parserVersion ?? (isMdx ? "native-mdx@4" : "native-markdown@4");
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const { text, encoding } = decodeDocumentText(input.body);
      const extension = input.filename.trim().toLowerCase().split(".").at(-1);
      const mimeType = normalizedMimeType(input.mimeType);
      const elements =
        extension === "properties" || mimeType === "text/x-java-properties"
          ? propertiesElements(text, options.maxElements ?? defaultMaxElements)
          : extension === "vtt" || mimeType === "text/vtt"
            ? vttElements(text, options.maxElements ?? defaultMaxElements)
            : markdownTokensToElements(marked.lexer(text, { gfm: true }));

      return createParseArtifact({
        artifactMetadata: { textEncoding: encoding },
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
  const parserVersion = options.parserVersion ?? "native-html@5";

  return {
    kind: "native-html",
    policyFingerprint: (input) =>
      nativeParserPolicyFingerprint(input, "native-html", parserVersion, options),
    parse: async (input) => {
      input.signal?.throwIfAborted();
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const { text, encoding } = decodeDocumentText(input.body);
      const document = parseDocument(text, {
        lowerCaseAttributeNames: true,
        lowerCaseTags: true,
      });
      const nodes = document.children as HtmlNode[];
      const elements = htmlNodesToElements(nodes);
      const documentTitle = htmlDocumentTitle(nodes);

      return createParseArtifact({
        artifactMetadata: { ...(documentTitle ? { documentTitle } : {}), textEncoding: encoding },
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
  const parserVersion = options.parserVersion ?? "native-structured@4";

  return {
    kind: "native-structured",
    policyFingerprint: (input) =>
      parserPolicyFingerprintHash(
        JSON.stringify({
          base: nativeParserPolicyFingerprint(input, "native-structured", parserVersion, options),
          maxRows: options.maxRows ?? defaultMaxRows,
        }),
      ),
    parse: async (input) => {
      input.signal?.throwIfAborted();
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const { text, encoding } = decodeDocumentText(input.body);
      const format = structuredDataFormat(input);

      if (!format) {
        throw new ProviderUnsupportedFileTypeError("Structured parser unsupported file type");
      }

      const elements = structuredDataElements(
        format,
        text,
        options.maxRows ?? defaultMaxRows,
        input.signal,
      );

      return createParseArtifact({
        artifactMetadata: { textEncoding: encoding },
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
  backendRevision = "external-unversioned",
  defaultLanguage,
  endpoint,
  fetch: fetchImpl = fetch,
  heavyMaxConcurrency,
  heavyRequestTimeoutMs,
  maxConcurrency = defaultMaxConcurrency,
  maxResponseBytes = defaultMaxResponseBytes,
  maxRetries = defaultMaxRetries,
  pdfMaxConcurrency,
  requestTimeoutMs = defaultRequestTimeoutMs,
  requestPreflight,
  pdfRequestTimeoutMs,
  retryDelayMs = defaultRetryDelayMs,
  sleep = sleepMs,
  ...options
}: UnstructuredParserClientOptions): ParserAdapter {
  if (heavyMaxConcurrency !== undefined) {
    validateUnstructuredConcurrency(heavyMaxConcurrency, "heavyMaxConcurrency");
  }
  if (pdfMaxConcurrency !== undefined) {
    validateUnstructuredConcurrency(pdfMaxConcurrency, "pdfMaxConcurrency");
  }
  if (heavyRequestTimeoutMs !== undefined) {
    validateUnstructuredRequestTimeout(heavyRequestTimeoutMs, "heavyRequestTimeoutMs");
  }
  if (pdfRequestTimeoutMs !== undefined) {
    validateUnstructuredRequestTimeout(pdfRequestTimeoutMs, "pdfRequestTimeoutMs");
  }
  const effectiveHeavyMaxConcurrency = heavyMaxConcurrency ?? pdfMaxConcurrency ?? maxConcurrency;
  const effectiveHeavyRequestTimeoutMs =
    heavyRequestTimeoutMs ?? pdfRequestTimeoutMs ?? requestTimeoutMs;
  validateRetryOptions({ maxRetries, retryDelayMs });
  validateUnstructuredResourceOptions({
    heavyMaxConcurrency: effectiveHeavyMaxConcurrency,
    heavyRequestTimeoutMs: effectiveHeavyRequestTimeoutMs,
    maxConcurrency,
    requestTimeoutMs,
  });
  const requestGate = createAbortAwareConcurrencyGate(maxConcurrency);
  const heavyRequestGate = createAbortAwareConcurrencyGate(effectiveHeavyMaxConcurrency);
  const requestCoordinator = createUnstructuredRequestCoordinator();
  const parserVersion = options.parserVersion ?? "unstructured@12";
  if (!backendRevision.trim() || backendRevision.length > 256) {
    throw new ProviderInputError(
      "Unstructured backendRevision must be a non-empty bounded identity",
    );
  }
  const maxInputBytes = options.maxInputBytes ?? defaultMaxInputBytes;
  const workloadCache = new WeakMap<
    Uint8Array,
    Readonly<{
      classification: UnstructuredWorkloadClassification;
      filename: string;
      mimeType: string;
    }>
  >();
  const resolveWorkload = (input: ParseDocumentInput): UnstructuredWorkloadClassification => {
    const filename = input.filename.trim().toLowerCase();
    const mimeType = normalizedMimeType(input.mimeType);
    const cached = workloadCache.get(input.body);
    if (cached?.filename === filename && cached.mimeType === mimeType) {
      return cached.classification;
    }
    const classification = classifyUnstructuredWorkload(input);
    workloadCache.set(input.body, { classification, filename, mimeType });
    return classification;
  };
  const resolveRequestPolicy = (input: ParseDocumentInput): UnstructuredRequestPolicy => ({
    backendRevision,
    partitionStrategy: unstructuredPartitionStrategy(input),
    providerImageBlockTypes: unstructuredProviderImageBlockTypes(input),
    providerLanguage: unstructuredLanguage(input.parserHints?.language ?? defaultLanguage),
  });
  const policyFingerprint = (input: ParseDocumentInput): string =>
    unstructuredRequestFingerprint(input, resolveRequestPolicy(input), {
      maxElements: options.maxElements ?? defaultMaxElements,
      parserVersion,
    });

  return {
    checkpointEligible: () => true,
    heavyWorkloadMaxConcurrency: effectiveHeavyMaxConcurrency,
    kind: "unstructured",
    workloadKind: (input) => resolveWorkload(input).kind,
    leaseMs: (input) => {
      const timeoutMs =
        resolveWorkload(input).kind === "heavy" ? effectiveHeavyRequestTimeoutMs : requestTimeoutMs;
      return timeoutMs + Math.min(maxParserLeaseGraceMs, timeoutMs);
    },
    policyFingerprint,
    parse: async (input) => {
      const { partitionStrategy, providerImageBlockTypes, providerLanguage } =
        resolveRequestPolicy(input);
      assertInputBounds(input.body, maxInputBytes);
      const workload = resolveWorkload(input);
      if (workload.kind === "rejected") {
        throw new ProviderInputError(
          "Unstructured parser rejected invalid or unsafe archive metadata",
        );
      }
      const requestPolicy = {
        backendRevision,
        partitionStrategy,
        providerImageBlockTypes,
        providerLanguage,
      } as const;
      const requestIsHeavy = workload.kind === "heavy";
      const effectiveRequestTimeoutMs = requestIsHeavy
        ? effectiveHeavyRequestTimeoutMs
        : requestTimeoutMs;

      return await requestCoordinator.run({
        callerSignal: input.signal,
        identity: {
          documentAssetId: input.documentAssetId,
          parserFingerprint: policyFingerprint(input),
          version: input.version,
        },
        // The coordinator deliberately owns the gate admission. A caller cancellation must not
        // release the gate while an identical transport is still active, because doing so lets a
        // durable retry overlap a provider request that survived the client disconnect.
        request: async ({ markTransportStarted, signal: admissionSignal }) => {
          const runTransport = async (): Promise<ParseArtifact> => {
            // File inspection shares the remote admission slot and single-flight lifetime. Never
            // mark an operation as remotely started until local checks succeed: a rejected file
            // has no ambiguous provider outcome and cancellation can still stop inspection.
            try {
              await assertOfficeArchiveSafe({ ...input, signal: admissionSignal });
            } catch (error) {
              if (error instanceof OfficeArchiveAdmissionError) {
                throw new ProviderInputError(error.message);
              }
              throw error;
            }
            await requestPreflight?.check({ ...input, signal: admissionSignal });
            admissionSignal.throwIfAborted();
            markTransportStarted();
            // This deadline belongs to the transport, not to any one caller. The coordinator waits
            // for it to settle before it reports a caller abort.
            const deadline = createUnstructuredRequestDeadline(effectiveRequestTimeoutMs);
            try {
              const response = await fetchWithRetries({
                buildRequest: () => {
                  const form = new FormData();
                  // Pass the admitted view directly. Slicing its backing buffer first creates an
                  // avoidable whole-file copy before FormData builds the multipart request.
                  const fileBody: Uint8Array<ArrayBuffer> =
                    input.body.buffer instanceof ArrayBuffer
                      ? new Uint8Array(
                          input.body.buffer,
                          input.body.byteOffset,
                          input.body.byteLength,
                        )
                      : new Uint8Array(Uint8Array.from(input.body));
                  form.set("files", new File([fileBody], input.filename, { type: input.mimeType }));
                  form.set("coordinates", "true");
                  form.set("strategy", partitionStrategy);
                  if (providerLanguage) form.set("languages", providerLanguage);
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
                payload = parseUnstructuredResponsePayload(responseText, {
                  maxResponseBytes,
                  signal: deadline.signal,
                });
              } catch (error) {
                throw new ProviderResponseError(
                  error instanceof ParserResourceLimitError
                    ? "Unstructured parser response exceeds structural resource limits"
                    : "Unstructured parser returned an invalid response",
                  { cause: error },
                );
              }

              const parsed = UnstructuredResponseSchema.safeParse(payload);

              if (!parsed.success) {
                throw new ProviderResponseError("Unstructured parser returned an invalid response");
              }

              const providerElements = unstructuredElementsToElements(
                normalizeUnstructuredLayout(parsed.data),
              );
              const mediaReport = createArchiveMediaReportCollector(
                input.parserHints?.requiresImages,
              );
              const elements = appendArchiveMediaFallbackElements(
                input,
                providerElements,
                mediaReport,
              );

              const artifact = await createParseArtifact({
                artifactHashContext: unstructuredArtifactHashContext(input, requestPolicy),
                artifactMetadata: { backendRevision, ...mediaReport.metadata() },
                elements,
                // The shared operation can outlive the first caller's cancellation.
                input: { ...input, signal: admissionSignal },
                kind: "unstructured",
                options,
                parserVersion,
              });
              deadline.throwIfExpired();
              return artifact;
            } catch (error) {
              if (deadline.expired()) {
                // A synchronous Unstructured server can keep processing after the client deadline
                // closes its socket. Mark this terminal for the durable worker so it cannot launch
                // another whole-document parse on top of that possible remote ghost request.
                throw new ProviderTimeoutError(
                  `Unstructured parser request timed out after requestTimeoutMs=${effectiveRequestTimeoutMs}`,
                  { cause: error },
                );
              }
              if (error instanceof ParserResourceLimitError) {
                throw new ProviderResponseError(
                  "Unstructured normalized output exceeds structural resource limits",
                  { cause: error },
                );
              }
              throw error;
            } finally {
              deadline.dispose();
            }
          };

          // Heavy requests acquire their narrow slot before the shared process slot. A heavy
          // request waiting on that cap therefore cannot occupy capacity needed by ordinary
          // documents. Standard requests never acquire the heavy gate, so lock order is acyclic.
          return requestIsHeavy
            ? await heavyRequestGate.run(
                () => requestGate.run(runTransport, admissionSignal),
                admissionSignal,
              )
            : await requestGate.run(runTransport, admissionSignal);
        },
      });
    },
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

function unstructuredLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return undefined;

  const baseLanguage = normalized.split("-", 1)[0] ?? normalized;
  return (
    {
      ar: "ara",
      de: "deu",
      en: "eng",
      es: "spa",
      fr: "fra",
      hi: "hin",
      ja: "jpn",
      ko: "kor",
      pt: "por",
      ru: "rus",
      zh: "zho",
    }[baseLanguage] ?? normalized
  );
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

interface UnstructuredRequestPolicy {
  readonly backendRevision: string;
  readonly partitionStrategy: "auto" | "fast" | "hi_res";
  readonly providerImageBlockTypes: readonly ("Image" | "Table")[];
  readonly providerLanguage?: string | undefined;
}

interface UnstructuredArtifactPolicy {
  readonly maxElements: number;
  readonly parserVersion: string;
}

function unstructuredRequestFingerprint(
  input: ParseDocumentInput,
  request: UnstructuredRequestPolicy,
  artifact: UnstructuredArtifactPolicy,
): string {
  return parserPolicyFingerprintHash(
    JSON.stringify({
      kind: "unstructured",
      parser: {
        artifactHashContext: unstructuredArtifactHashContext(input, request),
        maxElements: artifact.maxElements,
        version: artifact.parserVersion,
      },
    }),
  );
}

function unstructuredArtifactHashContext(
  input: ParseDocumentInput,
  request: UnstructuredRequestPolicy,
): string {
  const hints = input.parserHints;

  return JSON.stringify({
    backendRevision: request.backendRevision,
    filename: input.filename,
    mimeType: input.mimeType.trim().toLowerCase(),
    parserHints: {
      imagesHandledExternally: hints?.imagesHandledExternally === true,
      language: hints?.language?.trim().toLowerCase() || null,
      layoutComplexity: hints?.layoutComplexity ?? null,
      // Legacy auto extraction (undefined) and explicit text-only (false) produce different
      // archive media and must never share a checkpoint or in-flight request identity.
      requiresImages: hints?.requiresImages ?? null,
      requiresOcr: hints?.requiresOcr === true,
      requiresTables: hints?.requiresTables === true,
    },
    request: {
      coordinates: true,
      imageBlockTypes: request.providerImageBlockTypes,
      imagePayload: request.providerImageBlockTypes.length > 0,
      language: request.providerLanguage ?? null,
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
  report: ReturnType<typeof createArchiveMediaReportCollector>,
): ParseElementInput[] {
  const roots = archiveMediaRoots(input);

  if (
    !roots ||
    !zipSignatureIsSupported(input.body) ||
    input.parserHints?.requiresImages === false
  ) {
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
  let selectedMetadataBytes = 0;
  let selectedMetadataCount = 0;

  try {
    const archive = unzipSync(input.body, {
      filter: (file) => {
        if (/^(?:word|ppt|xl)\/(?:charts|diagrams)\/[^/]+\.xml$/iu.test(file.name)) {
          report.observe();
          report.skip(file.name, "office-visual-structure-not-rendered");
        }
        if (
          officeArchiveMetadataPath(input, file.name) &&
          selectedMetadataCount < defaultMaxArchiveMetadataCount &&
          file.originalSize >= 0 &&
          file.originalSize <= defaultMaxArchiveMetadataBytes &&
          selectedMetadataBytes + file.originalSize <= defaultMaxArchiveMetadataTotalBytes &&
          archivePathIsSafe(file.name)
        ) {
          selectedMetadataBytes += file.originalSize;
          selectedMetadataCount += 1;
          return true;
        }

        const mediaCandidate =
          archivePathMatchesRoots(file.name, roots) &&
          !file.name.endsWith("/") &&
          (roots[0] !== "" ||
            /\.(?:png|jpe?g|gif|webp|svg|tiff?|bmp|emf|wmf|avif|heic|ico)$/iu.test(file.name));
        if (!mediaCandidate) return false;
        report.observe();
        const reason = !archivePathIsSafe(file.name)
          ? "unsafe-resource-reference"
          : !archiveImageContentType(file.name)
            ? "unsupported-media-format"
            : file.originalSize < 1
              ? "empty-media-resource"
              : selectedCount >= defaultMaxArchiveImageCount
                ? "media-count-budget"
                : file.originalSize > defaultMaxArchiveImageBytes ||
                    selectedBytes + file.originalSize > defaultMaxArchiveImageTotalBytes
                  ? "media-byte-budget"
                  : undefined;
        if (reason) {
          report.skip(file.name, reason);
          return false;
        }

        selectedBytes += file.originalSize;
        selectedCount += 1;
        return true;
      },
    });
    const spreadsheetAnchors = spreadsheetImageAnchors(input, archive);
    const spreadsheetTables = spreadsheetTableTextIndex(elements);
    const wordAnchors = wordImageAnchors(input, archive, elements);
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
        const anchors = [
          ...(spreadsheetAnchors.get(archivePath) ?? []).map(
            (anchor): ArchiveImageAnchor => ({ kind: "spreadsheet", value: anchor }),
          ),
          ...(wordAnchors.byArchivePath.get(archivePath) ?? []).map(
            (anchor): ArchiveImageAnchor => ({ kind: "word", value: anchor }),
          ),
        ];
        if (
          anchors.length === 0 &&
          wordAnchors.alternateContentExcludedArchivePaths.has(archivePath)
        ) {
          return [];
        }
        const placements = anchors.length > 0 ? anchors : [undefined];

        return placements.map((anchor): ParseElementInput => {
          const placement =
            anchor?.kind === "spreadsheet"
              ? spreadsheetImageTextPlacement(anchor.value, spreadsheetTables)
              : anchor?.value.placement;
          const anchorMetadata =
            anchor?.kind === "spreadsheet"
              ? { spreadsheetAnchor: spreadsheetAnchorMetadata(anchor.value) }
              : anchor?.kind === "word"
                ? { wordAnchor: { paragraphIndex: anchor.value.paragraphIndex } }
                : {};
          return {
            metadata: {
              archivePath,
              assetRef: {
                contentType,
                uri,
              },
              ...(placement && anchor
                ? {
                    endOffset: placement.endOffset,
                    ...anchorMetadata,
                    startOffset: placement.startOffset,
                  }
                : {
                    positionUnknown: true,
                    ...anchorMetadata,
                  }),
              source: "archive-media-fallback",
              ...(title ? { title } : {}),
            },
            sectionPath: placement?.sectionPath ?? [],
            type: "image",
          };
        });
      });

    return [...elements, ...fallbackElements];
  } catch {
    // The authoritative parser response remains usable even when an optional archive-media
    // fallback cannot inspect a malformed or unsupported ZIP container.
    report.skip("", "archive-media-inspection-failed");
    return [...elements];
  }
}

interface SpreadsheetImageAnchor {
  readonly column: number;
  readonly contentRows: readonly number[];
  readonly row: number;
  readonly sheetIndex: number;
  readonly sheetName: string;
}

interface WordImageAnchor {
  readonly paragraphIndex: number;
  readonly placement?:
    | {
        readonly endOffset: number;
        readonly sectionPath: string[];
        readonly startOffset: number;
      }
    | undefined;
}

type ArchiveImageAnchor =
  | { readonly kind: "spreadsheet"; readonly value: SpreadsheetImageAnchor }
  | { readonly kind: "word"; readonly value: WordImageAnchor };

interface SpreadsheetTableTextIndexEntry {
  readonly endOffset: number;
  readonly headerRowCount: number;
  readonly pageNumber?: number | undefined;
  readonly recordOffsets: readonly {
    readonly endOffset: number;
    readonly startOffset: number;
  }[];
  readonly sectionPath: readonly string[];
  readonly sheetName?: string | undefined;
  readonly sourceRowCount: number;
  readonly startOffset: number;
}

interface SpreadsheetRelationship {
  readonly target: string;
  readonly type?: string | undefined;
}

const spreadsheetXmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

const wordXmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  removeNSPrefix: false,
  updateTag(tagName, _jPath, attributes) {
    for (const attributeName of Object.keys(attributes)) {
      if (attributeName.startsWith("xmlns:")) continue;
      const normalizedName = wordXmlLocalName(attributeName);
      if (normalizedName === attributeName) continue;
      const attributeValue = attributes[attributeName];
      if (attributeValue === undefined) continue;
      attributes[normalizedName] = attributeValue;
      delete attributes[attributeName];
    }
    return wordXmlLocalName(tagName);
  },
});

function wordXmlLocalName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

const wordAlternateContentSupportedNamespaces = new Set([
  "http://purl.oclc.org/ooxml/drawingml/main",
  "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "urn:schemas-microsoft-com:vml",
]);

function officeArchiveMetadataPath(input: ParseDocumentInput, path: string): boolean {
  return spreadsheetArchiveMetadataPath(input, path) || wordArchiveMetadataPath(input, path);
}

function spreadsheetArchiveMetadataPath(input: ParseDocumentInput, path: string): boolean {
  if (!spreadsheetArchive(input)) return false;

  return (
    path === "xl/workbook.xml" ||
    path === "xl/_rels/workbook.xml.rels" ||
    /^xl\/(?:drawings|worksheets)\/[^/]+\.xml$/u.test(path) ||
    /^xl\/(?:drawings|worksheets)\/_rels\/[^/]+\.xml\.rels$/u.test(path)
  );
}

function spreadsheetArchive(input: ParseDocumentInput): boolean {
  return archiveMediaRoots(input)?.includes("xl/media/") === true;
}

function wordArchiveMetadataPath(input: ParseDocumentInput, path: string): boolean {
  return (
    wordArchive(input) && (path === "word/document.xml" || path === "word/_rels/document.xml.rels")
  );
}

function wordArchive(input: ParseDocumentInput): boolean {
  return archiveMediaRoots(input)?.includes("word/media/") === true;
}

function wordImageAnchors(
  input: ParseDocumentInput,
  archive: Readonly<Record<string, Uint8Array>>,
  elements: readonly ParseElementInput[],
): WordImageAnchorIndex {
  const byArchivePath = new Map<string, WordImageAnchor[]>();
  const alternateContentExcludedArchivePaths = new Set<string>();
  if (!wordArchive(input)) return { alternateContentExcludedArchivePaths, byArchivePath };

  try {
    const documentBody = archive["word/document.xml"];
    if (!documentBody || documentBody.byteLength > defaultMaxArchiveMetadataBytes) {
      return { alternateContentExcludedArchivePaths, byArchivePath };
    }
    const documentXml = decodeUtf8(documentBody);
    const parsed = wordXmlParser.parse(documentXml) as unknown;
    const namespaceDeclarations = wordNamespaceDeclarations(parsed);
    const paragraphs = wordParagraphs(parsed, namespaceDeclarations);
    const relationships = spreadsheetRelationships(archive, "word/document.xml");
    const textIndex = wordParserTextIndex(elements);
    const paragraphPlacements = unambiguousWordParagraphPlacements(paragraphs, textIndex);
    let placement: WordImageAnchor["placement"];

    for (const paragraph of paragraphs) {
      const text = comparableWordText(paragraph.text);
      if (text) {
        placement = paragraphPlacements.get(paragraph.paragraphIndex);
      }

      for (const relationshipId of paragraph.alternateContentExcludedRelationshipIds) {
        const relationship = relationships.get(relationshipId);
        if (
          relationship &&
          relationshipTypeIs(relationship, "image") &&
          archiveImageContentType(relationship.target)
        ) {
          alternateContentExcludedArchivePaths.add(relationship.target);
        }
      }

      for (const relationshipId of paragraph.relationshipIds) {
        const relationship = relationships.get(relationshipId);
        if (
          !relationship ||
          !relationshipTypeIs(relationship, "image") ||
          !archiveImageContentType(relationship.target)
        ) {
          continue;
        }
        const current = byArchivePath.get(relationship.target) ?? [];
        current.push({
          paragraphIndex: paragraph.paragraphIndex,
          ...(placement ? { placement } : {}),
        });
        byArchivePath.set(relationship.target, current);
      }
    }
  } catch {
    // Word paragraph metadata is optional. Keep the media itself unpositioned if document XML or
    // its relationship part cannot be decoded safely.
    return {
      alternateContentExcludedArchivePaths: new Set(),
      byArchivePath: new Map(),
    };
  }

  return { alternateContentExcludedArchivePaths, byArchivePath };
}

interface WordImageAnchorIndex {
  readonly alternateContentExcludedArchivePaths: ReadonlySet<string>;
  readonly byArchivePath: ReadonlyMap<string, readonly WordImageAnchor[]>;
}

interface WordParagraph {
  readonly alternateContentExcludedRelationshipIds: readonly string[];
  readonly paragraphIndex: number;
  readonly relationshipIds: readonly string[];
  readonly text: string;
}

interface WordParagraphContent {
  readonly alternateContentExcludedRelationshipIds: string[];
  readonly relationshipIds: string[];
  readonly text: string;
}

function wordParagraphs(
  value: unknown,
  namespaceDeclarations: ReadonlyMap<string, string>,
): WordParagraph[] {
  const paragraphs: WordParagraph[] = [];

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!isPlainRecord(node)) continue;
      if (Array.isArray(node.p)) {
        const content = wordParagraphContent(node.p, namespaceDeclarations);
        paragraphs.push({
          alternateContentExcludedRelationshipIds: content.alternateContentExcludedRelationshipIds,
          paragraphIndex: paragraphs.length + 1,
          relationshipIds: content.relationshipIds,
          text: content.text,
        });
        continue;
      }
      for (const [key, nested] of Object.entries(node)) {
        if (key !== ":@") visit(nested);
      }
    }
  };

  visit(value);
  return paragraphs;
}

function wordParagraphContent(
  value: unknown,
  namespaceDeclarations: ReadonlyMap<string, string>,
): WordParagraphContent {
  const collect = (nodes: unknown): WordParagraphContent => {
    const alternateContentExcludedRelationshipIds: string[] = [];
    const relationshipIds: string[] = [];
    const text: string[] = [];
    if (!Array.isArray(nodes)) {
      return { alternateContentExcludedRelationshipIds, relationshipIds, text: "" };
    }
    for (const node of nodes) {
      if (!isPlainRecord(node)) continue;
      if (Array.isArray(node.AlternateContent)) {
        const selected = selectWordAlternateContent(
          node.AlternateContent,
          namespaceDeclarations,
          collect,
        );
        alternateContentExcludedRelationshipIds.push(
          ...selected.alternateContentExcludedRelationshipIds,
        );
        relationshipIds.push(...selected.relationshipIds);
        if (selected.text) text.push(selected.text);
        continue;
      }
      if (Array.isArray(node.t)) {
        for (const textNode of node.t) {
          if (isPlainRecord(textNode) && typeof textNode["#text"] === "string") {
            text.push(textNode["#text"]);
          }
        }
      }
      const attributes = isPlainRecord(node[":@"]) ? node[":@"] : undefined;
      const relationshipId =
        Array.isArray(node.blip) && attributes
          ? xmlScalarString(attributes.embed)
          : Array.isArray(node.imagedata) && attributes
            ? xmlScalarString(attributes.id)
            : undefined;
      if (relationshipId) relationshipIds.push(relationshipId);
      for (const [key, nested] of Object.entries(node)) {
        if (key !== ":@" && key !== "t" && key !== "blip" && key !== "imagedata") {
          const content = collect(nested);
          alternateContentExcludedRelationshipIds.push(
            ...content.alternateContentExcludedRelationshipIds,
          );
          relationshipIds.push(...content.relationshipIds);
          if (content.text) text.push(content.text);
        }
      }
    }
    return {
      alternateContentExcludedRelationshipIds,
      relationshipIds,
      text: text.join(""),
    };
  };

  return collect(value);
}

function selectWordAlternateContent(
  value: unknown,
  namespaceDeclarations: ReadonlyMap<string, string>,
  collect: (nodes: unknown) => WordParagraphContent,
): WordParagraphContent {
  if (!Array.isArray(value)) {
    return { alternateContentExcludedRelationshipIds: [], relationshipIds: [], text: "" };
  }
  const branches: Array<{
    readonly content: WordParagraphContent;
    readonly selected: boolean;
  }> = [];
  let supportedChoiceFound = false;
  for (const node of value) {
    if (!isPlainRecord(node)) continue;
    if (Array.isArray(node.Choice)) {
      const selected: boolean =
        !supportedChoiceFound && wordAlternateContentChoiceIsSupported(node, namespaceDeclarations);
      supportedChoiceFound ||= selected;
      branches.push({ content: collect(node.Choice), selected });
    }
    if (Array.isArray(node.Fallback)) {
      branches.push({ content: collect(node.Fallback), selected: !supportedChoiceFound });
    }
  }
  const selectedBranch = branches.find((branch) => branch.selected);
  return {
    alternateContentExcludedRelationshipIds: branches.flatMap((branch) =>
      branch === selectedBranch
        ? branch.content.alternateContentExcludedRelationshipIds
        : [
            ...branch.content.relationshipIds,
            ...branch.content.alternateContentExcludedRelationshipIds,
          ],
    ),
    relationshipIds: selectedBranch?.content.relationshipIds ?? [],
    text: selectedBranch?.content.text ?? "",
  };
}

function wordAlternateContentChoiceIsSupported(
  choice: Readonly<Record<string, unknown>>,
  namespaceDeclarations: ReadonlyMap<string, string>,
): boolean {
  const attributes = isPlainRecord(choice[":@"]) ? choice[":@"] : undefined;
  const requiredPrefixes = xmlScalarString(attributes?.Requires)?.split(/\s+/u) ?? [];
  return (
    requiredPrefixes.length > 0 &&
    requiredPrefixes.every((prefix) => {
      const namespace = namespaceDeclarations.get(prefix);
      return namespace !== undefined && wordAlternateContentSupportedNamespaces.has(namespace);
    })
  );
}

function wordNamespaceDeclarations(value: unknown): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  const conflictingPrefixes = new Set<string>();

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!isPlainRecord(node)) continue;
      const attributes = isPlainRecord(node[":@"]) ? node[":@"] : undefined;
      if (attributes) {
        for (const [name, rawNamespace] of Object.entries(attributes)) {
          if (!name.startsWith("xmlns:")) continue;
          const prefix = name.slice("xmlns:".length);
          const namespace = xmlScalarString(rawNamespace);
          if (!prefix || !namespace || conflictingPrefixes.has(prefix)) continue;
          const existing = declarations.get(prefix);
          if (existing !== undefined && existing !== namespace) {
            declarations.delete(prefix);
            conflictingPrefixes.add(prefix);
          } else {
            declarations.set(prefix, namespace);
          }
        }
      }
      for (const [key, nested] of Object.entries(node)) {
        if (key !== ":@") visit(nested);
      }
    }
  };

  visit(value);
  return declarations;
}

interface WordParserTextIndexEntry {
  readonly comparableText: string;
  readonly endOffset: number;
  readonly sectionPath: readonly string[];
  readonly startOffset: number;
}

function wordParserTextIndex(elements: readonly ParseElementInput[]): WordParserTextIndexEntry[] {
  const entries: WordParserTextIndexEntry[] = [];
  let nextOffset = 0;
  for (const element of elements) {
    const text = canonicalParserText(element.text);
    if (!text) continue;
    const startOffset = nextOffset;
    const endOffset = startOffset + canonicalTextEncoder.encode(text).byteLength;
    nextOffset = endOffset + 1;
    entries.push({
      comparableText: comparableWordText(text),
      endOffset,
      sectionPath: [...(element.sectionPath ?? [])],
      startOffset,
    });
  }
  return entries;
}

function comparableWordText(value: string): string {
  return normalizeText(value).normalize("NFKC");
}

function unambiguousWordParagraphPlacements(
  paragraphs: readonly WordParagraph[],
  textIndex: readonly WordParserTextIndexEntry[],
): Map<number, NonNullable<WordImageAnchor["placement"]>> {
  const paragraphOccurrences = new Map<string, number[]>();
  for (const paragraph of paragraphs) {
    const text = comparableWordText(paragraph.text);
    if (!text) continue;
    const occurrences = paragraphOccurrences.get(text) ?? [];
    occurrences.push(paragraph.paragraphIndex);
    paragraphOccurrences.set(text, occurrences);
  }

  const providerOccurrences = new Map<
    string,
    Array<{ readonly index: number; readonly placement: NonNullable<WordImageAnchor["placement"]> }>
  >();
  for (const [index, entry] of textIndex.entries()) {
    const occurrences = providerOccurrences.get(entry.comparableText) ?? [];
    occurrences.push({
      index,
      placement: {
        endOffset: entry.endOffset,
        sectionPath: [...entry.sectionPath],
        startOffset: entry.startOffset,
      },
    });
    providerOccurrences.set(entry.comparableText, occurrences);
  }

  const candidates: Array<{
    readonly paragraphIndex: number;
    readonly placement: NonNullable<WordImageAnchor["placement"]>;
    readonly providerIndex: number;
  }> = [];
  for (const [text, paragraphIndexes] of paragraphOccurrences) {
    const providerEntries = providerOccurrences.get(text);
    if (!providerEntries || providerEntries.length !== paragraphIndexes.length) continue;
    for (const [occurrenceIndex, paragraphIndex] of paragraphIndexes.entries()) {
      const providerEntry = providerEntries[occurrenceIndex];
      if (!providerEntry) continue;
      candidates.push({
        paragraphIndex,
        placement: providerEntry.placement,
        providerIndex: providerEntry.index,
      });
    }
  }
  candidates.sort((left, right) => left.paragraphIndex - right.paragraphIndex);

  const greatestProviderIndexBefore: number[] = [];
  let greatestProviderIndex = -1;
  for (const candidate of candidates) {
    greatestProviderIndexBefore.push(greatestProviderIndex);
    greatestProviderIndex = Math.max(greatestProviderIndex, candidate.providerIndex);
  }
  const leastProviderIndexAfter: number[] = Array.from(
    { length: candidates.length },
    () => Number.POSITIVE_INFINITY,
  );
  let leastProviderIndex = Number.POSITIVE_INFINITY;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    leastProviderIndexAfter[index] = leastProviderIndex;
    const candidate = candidates[index];
    if (candidate) leastProviderIndex = Math.min(leastProviderIndex, candidate.providerIndex);
  }

  const placements = new Map<number, NonNullable<WordImageAnchor["placement"]>>();
  for (const [index, candidate] of candidates.entries()) {
    if (
      candidate.providerIndex > (greatestProviderIndexBefore[index] ?? -1) &&
      candidate.providerIndex < (leastProviderIndexAfter[index] ?? Number.POSITIVE_INFINITY)
    ) {
      placements.set(candidate.paragraphIndex, candidate.placement);
    }
  }
  return placements;
}

function spreadsheetImageAnchors(
  input: ParseDocumentInput,
  archive: Readonly<Record<string, Uint8Array>>,
): Map<string, SpreadsheetImageAnchor[]> {
  const byArchivePath = new Map<string, SpreadsheetImageAnchor[]>();
  if (!spreadsheetArchive(input)) return byArchivePath;

  try {
    const workbook = xmlRecordProperty(parseSpreadsheetXml(archive, "xl/workbook.xml"), "workbook");
    const sheetContainer = xmlRecordProperty(workbook, "sheets");
    const sheets = xmlRecords(sheetContainer.sheet);
    const workbookRelationships = spreadsheetRelationships(archive, "xl/workbook.xml");

    for (const [sheetIndex, sheet] of sheets.entries()) {
      const sheetName = xmlString(sheet, "name");
      const relationshipId = xmlString(sheet, "id");
      const worksheetRelationship = relationshipId
        ? workbookRelationships.get(relationshipId)
        : undefined;
      if (
        !sheetName ||
        !worksheetRelationship ||
        !relationshipTypeIs(worksheetRelationship, "worksheet")
      ) {
        continue;
      }

      const worksheetPath = worksheetRelationship.target;
      const worksheet = xmlRecordProperty(parseSpreadsheetXml(archive, worksheetPath), "worksheet");
      const contentRows = spreadsheetWorksheetContentRows(worksheet);
      const worksheetRelationships = spreadsheetRelationships(archive, worksheetPath);
      const drawings = xmlRecords(worksheet.drawing);

      for (const drawing of drawings) {
        const drawingRelationshipId = xmlString(drawing, "id");
        const drawingRelationship = drawingRelationshipId
          ? worksheetRelationships.get(drawingRelationshipId)
          : undefined;
        if (!drawingRelationship || !relationshipTypeIs(drawingRelationship, "drawing")) {
          continue;
        }

        const drawingPath = drawingRelationship.target;
        const drawingRoot = xmlRecordProperty(parseSpreadsheetXml(archive, drawingPath), "wsDr");
        const drawingRelationships = spreadsheetRelationships(archive, drawingPath);
        const anchors = [
          ...xmlRecords(drawingRoot.twoCellAnchor),
          ...xmlRecords(drawingRoot.oneCellAnchor),
        ];

        for (const anchor of anchors) {
          const from = xmlRecordProperty(anchor, "from");
          const row = xmlNonNegativeInteger(from.row, 1_048_575);
          const column = xmlNonNegativeInteger(from.col, 16_383);
          const imageRelationshipId = firstXmlString(anchor, "embed");
          const imageRelationship = imageRelationshipId
            ? drawingRelationships.get(imageRelationshipId)
            : undefined;
          if (
            row === undefined ||
            column === undefined ||
            !imageRelationship ||
            !relationshipTypeIs(imageRelationship, "image") ||
            !archiveImageContentType(imageRelationship.target)
          ) {
            continue;
          }

          const current = byArchivePath.get(imageRelationship.target) ?? [];
          if (
            !current.some(
              (candidate) =>
                candidate.sheetIndex === sheetIndex &&
                candidate.row === row &&
                candidate.column === column,
            )
          ) {
            current.push({ column, contentRows, row, sheetIndex, sheetName });
            current.sort(
              (left, right) =>
                left.sheetIndex - right.sheetIndex ||
                left.row - right.row ||
                left.column - right.column,
            );
            byArchivePath.set(imageRelationship.target, current);
          }
        }
      }
    }
  } catch {
    // Spreadsheet drawing metadata is optional. Keep the media itself and fall back to an
    // unpositioned image when a malformed or unsupported OOXML relationship cannot be decoded.
    return new Map();
  }

  return byArchivePath;
}

function parseSpreadsheetXml(
  archive: Readonly<Record<string, Uint8Array>>,
  path: string,
): Record<string, unknown> {
  const body = archive[path];
  if (!body || body.byteLength > defaultMaxArchiveMetadataBytes) return {};
  const parsed = spreadsheetXmlParser.parse(decodeUtf8(body)) as unknown;
  return isPlainRecord(parsed) ? parsed : {};
}

function spreadsheetRelationships(
  archive: Readonly<Record<string, Uint8Array>>,
  sourcePath: string,
): Map<string, SpreadsheetRelationship> {
  const relationships = new Map<string, SpreadsheetRelationship>();
  const relationshipPath = spreadsheetRelationshipPartPath(sourcePath);
  const root = xmlRecordProperty(parseSpreadsheetXml(archive, relationshipPath), "Relationships");

  for (const relationship of xmlRecords(root.Relationship)) {
    const id = xmlString(relationship, "Id");
    const target = xmlString(relationship, "Target");
    const targetMode = xmlString(relationship, "TargetMode")?.toLowerCase();
    const resolvedTarget = target ? resolveSpreadsheetRelationshipTarget(sourcePath, target) : null;
    if (!id || !resolvedTarget || targetMode === "external") continue;
    const type = xmlString(relationship, "Type");
    relationships.set(id, {
      target: resolvedTarget,
      ...(type ? { type } : {}),
    });
  }

  return relationships;
}

function spreadsheetRelationshipPartPath(sourcePath: string): string {
  const separator = sourcePath.lastIndexOf("/");
  const directory = sourcePath.slice(0, separator + 1);
  const filename = sourcePath.slice(separator + 1);
  return `${directory}_rels/${filename}.rels`;
}

function resolveSpreadsheetRelationshipTarget(sourcePath: string, target: string): string | null {
  const normalizedTarget = target.trim().replaceAll("\\", "/");
  if (
    !normalizedTarget ||
    normalizedTarget.includes("\0") ||
    normalizedTarget.includes("?") ||
    normalizedTarget.includes("#") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalizedTarget)
  ) {
    return null;
  }

  const sourceDirectory = sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf("/") + 1));
  const segments = normalizedTarget.startsWith("/")
    ? []
    : sourceDirectory.split("/").filter(Boolean);
  for (const segment of normalizedTarget.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = segments.join("/");
  return resolved && archivePathIsSafe(resolved) ? resolved : null;
}

function relationshipTypeIs(
  relationship: SpreadsheetRelationship,
  expected: "drawing" | "image" | "worksheet",
): boolean {
  return relationship.type?.toLowerCase().endsWith(`/relationships/${expected}`) ?? false;
}

function spreadsheetWorksheetContentRows(worksheet: Record<string, unknown>): number[] {
  const sheetData = xmlRecordProperty(worksheet, "sheetData");
  return xmlRecords(sheetData.row)
    .flatMap((row) => {
      const sourceRow = xmlPositiveInteger(row.r, 1_048_576);
      const hasValue = xmlRecords(row.c).some((cell) =>
        ["f", "t", "v"].some((key) => firstXmlString(cell, key) !== undefined),
      );
      return sourceRow !== undefined && hasValue ? [sourceRow] : [];
    })
    .sort((left, right) => left - right);
}

function firstXmlString(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 24) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = firstXmlString(item, key, depth + 1);
      if (match !== undefined) return match;
    }
    return undefined;
  }
  if (!isPlainRecord(value)) return undefined;
  const direct = xmlScalarString(value[key]);
  if (direct !== undefined) return direct;
  for (const nested of Object.values(value)) {
    const match = firstXmlString(nested, key, depth + 1);
    if (match !== undefined) return match;
  }
  return undefined;
}

function xmlRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isPlainRecord);
  return isPlainRecord(value) ? [value] : [];
}

function xmlRecordProperty(value: unknown, key: string): Record<string, unknown> {
  return isPlainRecord(value) && isPlainRecord(value[key]) ? value[key] : {};
}

function xmlString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return xmlScalarString(value[key]);
}

function xmlScalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function xmlNonNegativeInteger(value: unknown, maximum: number): number | undefined {
  const parsed = Number.parseInt(xmlScalarString(value) ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : undefined;
}

function xmlPositiveInteger(value: unknown, maximum: number): number | undefined {
  const parsed = xmlNonNegativeInteger(value, maximum);
  return parsed !== undefined && parsed >= 1 ? parsed : undefined;
}

function spreadsheetAnchorMetadata(anchor: SpreadsheetImageAnchor): Record<string, unknown> {
  return {
    sheetIndex: anchor.sheetIndex,
    sheetName: anchor.sheetName,
    sourceColumn: anchor.column + 1,
    sourceRow: anchor.row + 1,
  };
}

function spreadsheetTableTextIndex(
  elements: readonly ParseElementInput[],
): SpreadsheetTableTextIndexEntry[] {
  const entries: SpreadsheetTableTextIndexEntry[] = [];
  let nextOffset = 0;

  for (const element of elements) {
    const text = canonicalParserText(element.text);
    if (!text) continue;
    const startOffset = nextOffset;
    const endOffset = startOffset + canonicalTextEncoder.encode(text).byteLength;
    nextOffset = endOffset + 1;
    if (element.type !== "table") continue;
    const table = isPlainRecord(element.metadata.table) ? element.metadata.table : undefined;
    const semanticVersion = numericValue(table?.semanticVersion);
    const recordCount = numericValue(table?.recordCount);
    const headerRowCount = numericValue(table?.headerRowCount);
    const sourceRowCount = numericValue(table?.sourceRowCount);
    const recordOffsets = canonicalNonEmptyLineOffsets(text, startOffset);
    if (
      semanticVersion !== 1 ||
      !Number.isSafeInteger(recordCount) ||
      recordCount !== recordOffsets.length ||
      !Number.isSafeInteger(headerRowCount) ||
      headerRowCount === undefined ||
      headerRowCount < 0 ||
      !Number.isSafeInteger(sourceRowCount) ||
      sourceRowCount === undefined ||
      sourceRowCount < headerRowCount + recordOffsets.length
    ) {
      continue;
    }
    const sheetName = spreadsheetElementSheetName(element);
    entries.push({
      endOffset,
      headerRowCount,
      ...(element.pageNumber ? { pageNumber: element.pageNumber } : {}),
      recordOffsets,
      sectionPath: [...(element.sectionPath ?? [])],
      ...(sheetName ? { sheetName } : {}),
      sourceRowCount,
      startOffset,
    });
  }

  return entries;
}

function canonicalParserText(text: string | undefined): string {
  return text?.replace(canonicalTextEdgeWhitespace, "") ?? "";
}

function canonicalNonEmptyLineOffsets(
  text: string,
  elementStartOffset: number,
): Array<{ readonly endOffset: number; readonly startOffset: number }> {
  const offsets: Array<{ readonly endOffset: number; readonly startOffset: number }> = [];
  let codeUnitStart = 0;
  let precedingBytes = 0;
  while (codeUnitStart <= text.length) {
    const newline = text.indexOf("\n", codeUnitStart);
    const codeUnitEnd = newline === -1 ? text.length : newline;
    const line = text.slice(codeUnitStart, codeUnitEnd);
    const lineBytes = canonicalTextEncoder.encode(line).byteLength;
    if (line.trim()) {
      offsets.push({
        endOffset: elementStartOffset + precedingBytes + lineBytes,
        startOffset: elementStartOffset + precedingBytes,
      });
    }
    if (newline === -1) break;
    precedingBytes += lineBytes + 1;
    codeUnitStart = codeUnitEnd + 1;
  }
  return offsets;
}

function spreadsheetElementSheetName(element: ParseElementInput): string | undefined {
  const candidates = ["page_name", "sheet_name", "sheetName", "worksheet", "worksheet_name"];
  for (const key of candidates) {
    const value = metadataString(element.metadata, key);
    if (value) return value;
  }
  const table = isPlainRecord(element.metadata.table) ? element.metadata.table : undefined;
  for (const key of candidates) {
    const value = table ? metadataString(table, key) : undefined;
    if (value) return value;
  }
  return undefined;
}

function spreadsheetImageTextPlacement(
  anchor: SpreadsheetImageAnchor,
  tables: readonly SpreadsheetTableTextIndexEntry[],
):
  | {
      readonly endOffset: number;
      readonly sectionPath: string[];
      readonly startOffset: number;
    }
  | undefined {
  const normalizedSheetName = comparableSpreadsheetSheetName(anchor.sheetName);
  const named = tables.filter(
    (table) =>
      table.sheetName !== undefined &&
      comparableSpreadsheetSheetName(table.sheetName) === normalizedSheetName,
  );
  const paged = tables.filter((table) => table.pageNumber === anchor.sheetIndex + 1);
  const candidates = named.length > 0 ? named : paged.length > 0 ? paged : tables;
  if (candidates.length !== 1) return undefined;
  const table = candidates[0] as SpreadsheetTableTextIndexEntry;
  const sourceRow = anchor.row + 1;
  const contentRowIndex = anchor.contentRows.indexOf(sourceRow);
  if (anchor.contentRows.length > 0 && contentRowIndex === -1) return undefined;
  const tableSourceRow = contentRowIndex === -1 ? sourceRow : contentRowIndex + 1;
  if (tableSourceRow > table.sourceRowCount) return undefined;
  const recordIndex = tableSourceRow - table.headerRowCount - 1;
  const record = table.recordOffsets[recordIndex];
  if (!record) return undefined;

  return {
    endOffset: record.endOffset,
    sectionPath: [...table.sectionPath],
    startOffset: record.startOffset,
  };
}

function comparableSpreadsheetSheetName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
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
  const routeOptions = {
    html,
    markdown,
    ...(maxNativeInputBytes === undefined ? {} : { maxNativeInputBytes }),
    ...(nativeLanguages === undefined ? {} : { nativeLanguages }),
    ...(structured === undefined ? {} : { structured }),
    unstructured,
  };
  const resolveRoute = (input: ParseDocumentInput) => selectParser(input, routeOptions);

  return {
    checkpointEligible: (input) => {
      const route = resolveRoute(input);
      return route.parser.checkpointEligible?.(input) === true;
    },
    ...(unstructured.heavyWorkloadMaxConcurrency === undefined
      ? {}
      : { heavyWorkloadMaxConcurrency: unstructured.heavyWorkloadMaxConcurrency }),
    kind: "unstructured",
    leaseMs: (input) => {
      const route = resolveRoute(input);
      return route.parser.leaseMs?.(input);
    },
    policyFingerprint: (input) => {
      const route = resolveRoute(input);
      const effectiveFingerprint = route.parser.policyFingerprint?.(input);

      return effectiveFingerprint
        ? parserPolicyFingerprintHash(
            JSON.stringify({
              effectiveFingerprint,
              kind: "router",
              routeReason: route.reason,
              routedParser: route.parser.kind,
            }),
          )
        : undefined;
    },
    workloadKind: (input) => {
      const route = resolveRoute(input);
      return route.parser.workloadKind?.(input) ?? "standard";
    },
    parse: async (input) => {
      const route = resolveRoute(input);
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

  const format = resolveDocumentFormat(input);
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

  if (format === "unstructured") {
    return { parser: unstructured, reason: "complex-file-type" };
  }

  const structuredFormat = structuredDataFormat(input);

  if (!structured && structuredFormat && input.body.byteLength > maxNativeInputBytes) {
    return { parser: unstructured, reason: "native-size-limit" };
  }

  if (structured && structuredFormat) {
    return { parser: structured, reason: "structured-file-type" };
  }

  const nativeParser =
    format === "markdown" || format === "properties" || format === "vtt"
      ? markdown
      : format === "html"
        ? html
        : null;

  if (!nativeParser) {
    return { parser: unstructured, reason: "unsupported-file-type" };
  }

  if (input.body.byteLength > maxNativeInputBytes) {
    throw new ProviderInputError(
      `Native parser input exceeds maxNativeInputBytes=${maxNativeInputBytes}`,
    );
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

  input.signal?.throwIfAborted();
  assertParserResourceBudget(
    { elements, metadata: artifactMetadata },
    {
      maxNodes: parserResourceLimits.maxArtifactNodes,
      signal: input.signal,
    },
  );

  if (elements.length > maxElements) {
    const message = `Parser output exceeds maxElements=${maxElements}`;
    throw kind === "unstructured"
      ? new ProviderResponseError(message)
      : new ProviderInputError(message);
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
  const format = resolveDocumentFormat({ filename, mimeType });
  return format === "csv" ||
    format === "json" ||
    format === "jsonl" ||
    format === "xml" ||
    format === "yaml"
    ? format
    : null;
}

function structuredDataElements(
  format: StructuredDataFormat,
  text: string,
  maxRows: number,
  signal?: AbortSignal,
): ParseElementInput[] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("Structured parser maxRows must be at least 1");
  }

  try {
    if (format === "csv") {
      const { columns, rows } = parseCsvRows(text, maxRows);
      return rowsToTableElements(format, rows, maxRows, columns);
    }

    if (format === "jsonl") {
      const records = parseJsonLines(text, maxRows, signal);
      if (records.every(isDocumentRecord)) return rowsToTableElements(format, records, maxRows);
      const lines = records.map((record) => stringifyDocumentJson(record));
      assertParserResourceBudget(lines);
      return [
        {
          metadata: { format, rowCount: records.length },
          sectionPath: [],
          text: lines.join("\n"),
          type: "code",
        },
      ];
    }

    if (format === "json") {
      return structuredValueElements(format, parseDocumentJson(text), maxRows);
    }

    if (format === "yaml") {
      return structuredValueElements(format, parseYaml(text), maxRows);
    }

    assertXmlStructureBudget(text, { signal });
    return structuredValueElements(
      format,
      new XMLParser({
        ignoreAttributes: false,
        parseTagValue: false,
        parseAttributeValue: false,
      }).parse(text),
      maxRows,
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ParserResourceLimitError) throw error;
    if (error instanceof Error && error.message.startsWith("Structured parser")) {
      throw new ProviderInputError(error.message, { cause: error });
    }

    throw new ProviderInputError("Structured parser input is malformed", { cause: error });
  }
}

function parseCsvRows(
  text: string,
  maxRows: number,
): { columns: readonly string[]; rows: Record<string, unknown>[] } {
  let rows = 0;
  let columns: string[] | undefined;
  const records: Record<string, unknown>[] = [];

  parseCsv(text, {
    // Decode arrays first: csv-parse's object projection assigns __proto__ instead of defining
    // it as an own column. Object.fromEntries preserves every user-supplied header safely.
    on_record: (record: string[]) => {
      if (!columns) {
        if (record.length > parserResourceLimits.maxTableColumns)
          throw new ParserResourceLimitError("table column count");
        columns = uniqueColumnNames(record);
        return null;
      }
      rows += 1;

      if (rows > maxRows) {
        throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
      }

      records.push(
        Object.fromEntries(columns.map((column, index) => [column, record[index] ?? ""])),
      );
      return null;
    },
    skip_empty_lines: true,
    trim: true,
  });
  return { columns: columns ?? [], rows: records };
}

function parseJsonLines(text: string, maxRows: number, signal?: AbortSignal): unknown[] {
  const rows: unknown[] = [];

  for (const rawLine of iterateDocumentLines(text, signal)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (rows.length >= maxRows) {
      throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
    }

    rows.push(parseDocumentJson(line));
  }

  return rows;
}

function structuredValueElements(
  format: StructuredDataFormat,
  value: unknown,
  maxRows: number,
): ParseElementInput[] {
  assertParserResourceBudget(value);
  if (Array.isArray(value) && value.every(isDocumentRecord)) {
    return rowsToTableElements(format, value as Record<string, unknown>[], maxRows);
  }

  return [
    {
      metadata: {
        format,
        rootType: documentJsonRootType(value),
      },
      sectionPath: [],
      text: stringifyDocumentJson(value, true),
      type: "code",
    },
  ];
}

function rowsToTableElements(
  format: StructuredDataFormat,
  rows: readonly Record<string, unknown>[],
  maxRows: number,
  sourceColumns?: readonly string[],
): ParseElementInput[] {
  if (rows.length > maxRows) {
    throw new Error(`Structured parser row count exceeds maxRows=${maxRows}`);
  }

  assertParserResourceBudget(rows);
  const columns = sourceColumns ?? uniqueStrings(rows.flatMap((row) => Object.keys(row)));
  if (columns.length > parserResourceLimits.maxTableColumns)
    throw new ParserResourceLimitError("table column count");
  const actualCellCount = rows.reduce((count, row) => count + Object.keys(row).length, 0);
  if (actualCellCount > parserResourceLimits.maxTableCells)
    throw new ParserResourceLimitError("table cell count");
  const denseCellCount = rows.length * columns.length;
  if (denseCellCount > Math.max(actualCellCount * 8, 10_000)) {
    const lines = rows.map((row) =>
      Object.entries(row)
        .map(
          ([key, value]) =>
            `${normalizeTableCell(key)}: ${normalizeTableCell(structuredCell(value))}`,
        )
        .join(" | "),
    );
    assertParserResourceBudget(lines);
    return [
      {
        metadata: {
          columns,
          format,
          rowCount: rows.length,
          table: {
            columns,
            headerRowCount: 0,
            mode: "record-list",
            recordCount: rows.length,
            semanticVersion: 1,
            sourceRowCount: rows.length,
            sparse: true,
          },
        },
        sectionPath: [],
        text: lines.join("\n"),
        type: "table",
      },
    ];
  }
  if (denseCellCount > parserResourceLimits.maxTableCells)
    throw new ParserResourceLimitError("expanded table cell count");
  const headerRowCount = format === "csv" ? 1 : 0;
  const projection = projectTableRecords({
    columns,
    headerRowCount,
    rows: rows.map((row) =>
      columns.map((column) =>
        Object.prototype.hasOwnProperty.call(row, column) ? structuredCell(row[column]) : "",
      ),
    ),
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
  tableBudget = { expandedCells: 0, projectedBytes: 0 },
}: {
  readonly columns: readonly string[];
  readonly headerRowCount: number;
  readonly mode?: TableSemanticMode | undefined;
  readonly rows: readonly (readonly string[])[];
  readonly sourceRowCount?: number | undefined;
  readonly tableBudget?: HtmlTableExpansionBudget;
}): TableProjection {
  let width = Math.max(rawColumns.length, 1);
  for (const row of rows) width = Math.max(width, row.length);
  if (width > parserResourceLimits.maxTableColumns)
    throw new ParserResourceLimitError("table column count");
  if (width * rows.length > parserResourceLimits.maxTableCells)
    throw new ParserResourceLimitError("expanded table cell count");
  const columns = uniqueColumnNames(
    Array.from({ length: width }, (_, index) => normalizeTableCell(rawColumns[index] ?? "")),
  );
  const columnBytes = columns.map((column) => Buffer.byteLength(column));
  if (rows.length === 0) {
    consumeTableProjectionBytes(
      tableBudget,
      columnBytes.reduce((total, bytes) => total + bytes, Math.max(0, columns.length - 1) * 3),
    );
  }
  const lines: string[] = [];
  let matrixCellCount = 0;
  let numericCellCount = 0;
  for (const row of rows) {
    const cells: string[] = [];
    for (let index = 0; index < columns.length; index += 1) {
      const value = normalizeTableCell(row[index] ?? "");
      consumeTableProjectionBytes(
        tableBudget,
        (columnBytes[index] ?? 0) +
          2 +
          Buffer.byteLength(value) +
          (index === 0 ? (lines.length > 0 ? 1 : 0) : 3),
      );
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
    return stringifyDocumentJson(value);
  }

  return String(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueColumnNames(names: readonly string[]): string[] {
  const reserved = new Set(names);
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return names.map((name, index) => {
    const base = name || `column_${index + 1}`;
    let candidate = base;
    let suffix = nextSuffix.get(base) ?? 2;
    while (used.has(candidate) || (candidate !== base && reserved.has(candidate))) {
      candidate = `${base}_${suffix++}`;
    }
    used.add(candidate);
    nextSuffix.set(base, suffix);
    return candidate;
  });
}

function markdownTokensToElements(tokens: readonly Token[]): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];
  const tableBudget: HtmlTableExpansionBudget = { expandedCells: 0, projectedBytes: 0 };
  const pending = tokens.map((token) => ({ token, depth: 0 })).reverse();
  let visited = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const { token, depth } = entry;
    visited += 1;
    if (visited > parserResourceLimits.maxNodes || depth > parserResourceLimits.maxDepth) {
      throw new ParserResourceLimitError("Markdown token count or depth");
    }
    if (token.type === "space") {
      continue;
    }

    if (token.type === "blockquote") {
      for (const child of [...(token as Tokens.Blockquote).tokens].reverse()) {
        pending.push({ token: child, depth: depth + 1 });
      }
      continue;
    }

    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      const images = markdownImagesFromToken(heading);
      if (images.length > 0 || /<[!\/a-z]/iu.test(heading.text)) {
        pushMarkdownHtmlElements(token, elements, sectionPath, images, tableBudget);
        continue;
      }
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
      if (images.length > 0 || /<[!\/a-z]/iu.test(paragraph.text)) {
        pushMarkdownHtmlElements(token, elements, sectionPath, images, tableBudget);
      } else {
        pushTextElement(elements, "paragraph", paragraph.text, sectionPath);
      }
      continue;
    }

    if (token.type === "html") {
      pushMarkdownHtmlElements(token, elements, sectionPath, [], tableBudget);
      continue;
    }

    if (token.type === "list") {
      const list = token as Tokens.List;
      const images = markdownImagesFromToken(list);
      if (images.length > 0 || /<[!\/a-z]/iu.test(list.raw)) {
        pushMarkdownHtmlElements(token, elements, sectionPath, images, tableBudget);
      } else {
        pushTextElement(
          elements,
          "list",
          list.items.map((item) => item.text).join("\n"),
          sectionPath,
        );
      }
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
      const images = markdownImagesFromToken(table);
      if (images.length > 0 || /<[!\/a-z]/iu.test(table.raw)) {
        pushMarkdownHtmlElements(token, elements, sectionPath, images, tableBudget);
        continue;
      }
      const projection = markdownTableProjection(table, tableBudget);
      pushTextElement(elements, "table", projection.text, sectionPath, {
        table: projection.metadata,
      });
    }
  }

  return elements;
}

function pushMarkdownHtmlElements(
  token: Token,
  elements: ParseElementInput[],
  sectionPath: string[],
  images: readonly MarkdownImageRef[],
  tableBudget: HtmlTableExpansionBudget,
): void {
  // Render syntax to an inert DOM, never evaluate JSX, execute scripts or fetch referenced URLs.
  // This keeps text/image order while the same HTML visitor excludes non-searchable subtrees.
  const source =
    token.type === "html" ? (token as Tokens.HTML).text : marked.parser([token], { async: false });
  const nodes = parseDocument(source).children as HtmlNode[];
  assertHtmlStructureBudget(nodes);
  const start = elements.length;
  visitHtmlNode({ children: nodes }, elements, sectionPath, tableBudget);
  const references = new Set(images.map((image) => image.uri));
  for (let index = start; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element) continue;
    const assetRef = element.metadata.assetRef as { uri?: string } | undefined;
    if (element.type !== "image" || !assetRef?.uri || !references.has(assetRef.uri)) continue;
    const alt = metadataString(element.metadata, "alt");
    const title = metadataString(element.metadata, "title");
    elements[index] = {
      ...element,
      metadata: {
        assetRef: cloneMetadata(element.metadata.assetRef as Readonly<Record<string, unknown>>),
        ...(alt ? { caption: alt } : {}),
        source: "markdown-image",
        ...(title ? { title } : {}),
      },
    };
  }
}

function isMdxInput({
  filename,
  mimeType,
}: Pick<ParseDocumentInput, "filename" | "mimeType">): boolean {
  return (
    mimeType.trim().toLowerCase() === "text/mdx" || filename.trim().toLowerCase().endsWith(".mdx")
  );
}

function htmlNodesToElements(nodes: readonly HtmlNode[]): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];
  const tableBudget: HtmlTableExpansionBudget = { expandedCells: 0, projectedBytes: 0 };
  assertHtmlStructureBudget(nodes);
  visitHtmlNode({ children: nodes }, elements, sectionPath, tableBudget);
  return elements;
}

function htmlDocumentTitle(nodes: readonly HtmlNode[]): string | undefined {
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) break;
    if (node.name?.toLowerCase() === "title") {
      const title = normalizeText(htmlText(node));
      if (title) return Array.from(title).slice(0, defaultMaxDocumentTitleChars).join("");
    }
    for (const child of [...(node.children ?? [])].reverse()) pending.push(child);
  }
  return undefined;
}

function assertHtmlStructureBudget(nodes: readonly HtmlNode[]): void {
  const pending = nodes.map((node) => ({ node, depth: 0 }));
  let count = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const { node, depth } = entry;
    count += 1;
    if (count > parserResourceLimits.maxNodes || depth > parserResourceLimits.maxDepth) {
      throw new ParserResourceLimitError("HTML node count or depth");
    }
    for (const child of node.children ?? []) {
      pending.push({ node: child, depth: depth + 1 });
      if (pending.length + count > parserResourceLimits.maxNodes) {
        throw new ParserResourceLimitError("HTML node count");
      }
    }
  }
}

const searchableHtmlBlockNames = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "dd",
  "div",
  "dl",
  "dt",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

function pushHtmlInlineElements(
  nodes: readonly HtmlNode[],
  elements: ParseElementInput[],
  sectionPath: readonly string[],
  type: "paragraph" | "list" = "paragraph",
  figureCaption?: string,
): void {
  const pending: (HtmlNode | string)[] = [...nodes].reverse();
  let text = "";
  const flush = () => {
    pushTextElement(elements, type, text, sectionPath);
    text = "";
  };
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (typeof node === "string") {
      text += node;
      continue;
    }
    const name = node.name?.toLowerCase();
    if (name && ["script", "style", "noscript", "title"].includes(name)) continue;
    if (name === "figcaption" && figureCaption !== undefined) continue;
    if (name === "img") {
      flush();
      pushHtmlImageElement(
        elements,
        node,
        sectionPath,
        figureCaption || undefined,
        figureCaption === undefined ? "html-img" : "html-figure",
      );
    } else if (name === "br") {
      text += "\n";
    } else if (node.children?.length) {
      const block = name && searchableHtmlBlockNames.has(name);
      if (block) {
        text += "\n";
        pending.push("\n");
      }
      for (const child of [...node.children].reverse()) pending.push(child);
    } else {
      text += htmlText(node);
    }
  }
  flush();
}

function visitHtmlNode(
  node: HtmlNode,
  elements: ParseElementInput[],
  sectionPath: string[],
  tableBudget: HtmlTableExpansionBudget,
): void {
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

    for (const image of findHtmlElements(node, "img")) {
      pushHtmlImageElement(elements, image, sectionPath, undefined, "html-img");
    }

    return;
  }

  if (name === "p") {
    pushHtmlInlineElements(node.children ?? [], elements, sectionPath);
    return;
  }

  if (name === "ul" || name === "ol") {
    pushHtmlInlineElements(node.children ?? [], elements, sectionPath, "list");
    return;
  }

  if (name === "pre" || name === "code") {
    pushTextElement(elements, "code", htmlText(node), sectionPath);
    return;
  }

  if (name === "table") {
    const projection = htmlTableProjection(node, tableBudget);
    pushTextElement(elements, "table", projection.text, sectionPath, {
      table: projection.metadata,
    });
    for (const image of findHtmlElements(node, "img")) {
      pushHtmlImageElement(elements, image, sectionPath, undefined, "html-img");
    }
    return;
  }

  if (name === "figure") {
    if (findHtmlElements(node, "img").length > 0) {
      const caption = normalizeText(
        findHtmlElements(node, "figcaption")
          .map((captionNode) => htmlText(captionNode))
          .join(" "),
      );
      pushHtmlInlineElements(node.children ?? [], elements, sectionPath, "paragraph", caption);
      return;
    }
  }

  if (name === "img") {
    pushHtmlImageElement(elements, node, sectionPath, undefined, "html-img");
    return;
  }

  if (!node.children?.length) {
    pushHtmlInlineElements([node], elements, sectionPath);
    return;
  }
  let inline: HtmlNode[] = [];
  for (const child of node.children) {
    if (child.name && searchableHtmlBlockNames.has(child.name.toLowerCase())) {
      pushHtmlInlineElements(inline, elements, sectionPath);
      inline = [];
      visitHtmlNode(child, elements, sectionPath, tableBudget);
    } else {
      inline.push(child);
    }
  }
  pushHtmlInlineElements(inline, elements, sectionPath);
}

function unstructuredElementsToElements(
  sourceElements: readonly z.infer<typeof UnstructuredElementSchema>[],
): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];
  const headingPathsByElementId = new Map<string, string[]>();
  const tableBudget: HtmlTableExpansionBudget = { expandedCells: 0, projectedBytes: 0 };
  let sectionPathItems = 0;

  for (const sourceElement of sourceElements) {
    const type = unstructuredType(sourceElement.type);
    const tableProjection =
      type === "table"
        ? unstructuredTableProjection(sourceElement.metadata, tableBudget)
        : undefined;
    const providerText = tableProjection?.text ?? normalizeText(sourceElement.text ?? "");
    const text = hasChineseOcrLanguage(sourceElement.metadata)
      ? normalizeChineseOcrText(providerText)
      : providerText;

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
      if (nextPath.length > maxUnstructuredSectionDepth) {
        throw new ProviderResponseError(
          `Unstructured parser output exceeds maxSectionDepth=${maxUnstructuredSectionDepth}`,
        );
      }
      sectionPath.splice(0, sectionPath.length, ...nextPath);

      if (sourceElement.element_id) {
        headingPathsByElementId.set(sourceElement.element_id, [...sectionPath]);
      }
    }

    sectionPathItems += sectionPath.length;
    if (sectionPathItems > maxUnstructuredSectionPathItems) {
      throw new ProviderResponseError(
        `Unstructured parser output exceeds maxSectionPathItems=${maxUnstructuredSectionPathItems}`,
      );
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

function hasChineseOcrLanguage(metadata: Readonly<Record<string, unknown>>): boolean {
  const languages = metadata.languages;
  return (
    Array.isArray(languages) &&
    languages.some(
      (language) =>
        typeof language === "string" &&
        (language.trim().toLowerCase() === "zho" ||
          language.trim().toLowerCase().startsWith("zh-")),
    )
  );
}

function normalizeChineseOcrText(text: string): string {
  return text.replace(
    /(?<=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[\t \u3000]+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu,
    "",
  );
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

      if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) {
        throw new ProviderResponseError("Unstructured parser returned invalid glyph geometry");
      }

      return { box, element, index, pageNumber, text };
    })
    .filter((glyph): glyph is UnstructuredVerticalGlyph => glyph !== null)
    .sort(compareUnstructuredVerticalGlyphs);
  const availableIndexes = new Set(glyphs.map((glyph) => glyph.index));
  const candidateIndex = createUnstructuredGlyphIndex(glyphs);
  let candidateComparisons = 0;
  const mergedByIndex = new Map<number, UnstructuredSourceElement>();
  const removedIndexes = new Set<number>();

  for (const first of glyphs) {
    if (!availableIndexes.delete(first.index)) {
      continue;
    }
    candidateIndex.remove(first);

    const group = [first];
    let current = first;

    while (true) {
      let next: UnstructuredVerticalGlyph | undefined;
      let nextDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidateIndex.candidates(current)) {
        candidateComparisons += 1;
        if (candidateComparisons > maxUnstructuredVerticalCandidateComparisons) {
          throw new ProviderResponseError(
            `Unstructured parser layout exceeds maxVerticalCandidateComparisons=${maxUnstructuredVerticalCandidateComparisons}`,
          );
        }
        if (!unstructuredVerticalGlyphsAreAdjacent(current, candidate)) continue;
        const distance = verticalGlyphDistance(current, candidate);
        if (
          !next ||
          distance < nextDistance ||
          (distance === nextDistance && compareUnstructuredVerticalGlyphs(candidate, next) < 0)
        ) {
          next = candidate;
          nextDistance = distance;
        }
      }

      if (!next) {
        break;
      }

      availableIndexes.delete(next.index);
      candidateIndex.remove(next);
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
  tableBudget: HtmlTableExpansionBudget,
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
  return table ? htmlTableProjection(table, tableBudget) : undefined;
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

function markdownTableProjection(
  table: Tokens.Table,
  tableBudget: HtmlTableExpansionBudget,
): TableProjection {
  return projectTableRecords({
    columns: table.header.map((cell) => normalizeText(cell.text)),
    headerRowCount: 1,
    rows: table.rows.map((row) => row.map((cell) => normalizeText(cell.text))),
    tableBudget,
  });
}

interface HtmlTableExpansionBudget {
  // Created once per document normalization, never stored on a reusable parser adapter.
  expandedCells: number;
  projectedBytes: number;
}

function consumeTableProjectionBytes(
  tableBudget: HtmlTableExpansionBudget,
  addedBytes: number,
): void {
  if (tableBudget.projectedBytes + addedBytes > parserResourceLimits.maxOutputBytes) {
    throw new ParserResourceLimitError("table projection bytes");
  }
  tableBudget.projectedBytes += addedBytes;
}

function consumeHtmlTableCells(tableBudget: HtmlTableExpansionBudget, addedCells: number): void {
  if (tableBudget.expandedCells + addedCells > parserResourceLimits.maxTableCells) {
    throw new ParserResourceLimitError("expanded HTML table cell count");
  }
  tableBudget.expandedCells += addedCells;
}

function htmlTableProjection(
  node: HtmlNode,
  tableBudget: HtmlTableExpansionBudget,
): TableProjection {
  const rows = htmlTableRows(node, tableBudget);
  let width = 0;
  let populatedRowCells = 0;
  for (const row of rows) {
    width = Math.max(width, row.cells.length);
    populatedRowCells += row.cells.length;
  }
  // Projection scans the rectangular logical table, including short-row padding. Charge only
  // the added padding here; source/rowspan cells (including filtered empty rows) were charged
  // before assignment, and must not be counted twice.
  consumeHtmlTableCells(tableBudget, width * rows.length - populatedRowCells);
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
      tableBudget,
    });
  }
  return projectHeaderlessTableRows(
    rows.map((row) => row.cells),
    tableBudget,
  );
}

function htmlTableRows(
  node: HtmlNode,
  tableBudget: HtmlTableExpansionBudget,
): Array<{
  readonly cells: readonly string[];
  readonly hasHeaderCell: boolean;
  readonly inHeaderGroup: boolean;
}> {
  const headerRows = new Set(
    findHtmlElements(node, "thead").flatMap((header) => findHtmlElements(header, "tr")),
  );
  let activeRowspans = new Map<number, { readonly remaining: number; readonly value: string }>();
  const writeCell = (cells: string[], column: number, value: string) => {
    if (column >= parserResourceLimits.maxTableColumns) {
      throw new ParserResourceLimitError("HTML table column count");
    }
    // Sparse carried rows still reserve every column up to their final cell.
    const addedCells = Math.max(0, column + 1 - cells.length);
    consumeHtmlTableCells(tableBudget, addedCells);
    cells[column] = value;
  };
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
        writeCell(cells, column, carried.value);
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
          writeCell(cells, column, value);
          if (rowSpan > 1) {
            nextRowspans.set(column, { remaining: rowSpan - 1, value });
          }
          column += 1;
        }
      }
      // Remaining reservations are ordered by column; skip holes without scanning them.
      for (const carriedColumn of activeRowspans.keys()) {
        column = carriedColumn;
        consumeRowspan();
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
  let width = 1;
  for (const row of rows) width = Math.max(width, row.cells.length);
  if (width > parserResourceLimits.maxTableColumns)
    throw new ParserResourceLimitError("HTML table column count");
  if (width * rows.length > parserResourceLimits.maxTableCells)
    throw new ParserResourceLimitError("expanded HTML table cell count");
  let headerBytes = 0;
  return Array.from({ length: width }, (_, column) => {
    const labels: string[] = [];
    for (const row of rows) {
      const label = row.cells[column]?.trim();
      if (label && labels.at(-1) !== label) {
        headerBytes += Buffer.byteLength(label, "utf8") + (labels.length > 0 ? 3 : 0);
        if (headerBytes > parserResourceLimits.maxOutputBytes)
          throw new ParserResourceLimitError("HTML table header bytes");
        labels.push(label);
      }
    }
    return labels.join(" / ");
  });
}

function htmlTableCellSpan(cell: HtmlNode, attribute: "colspan" | "rowspan"): number {
  const parsed = Number.parseInt(cell.attribs?.[attribute] ?? "1", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 256 ? parsed : 1;
}

function projectHeaderlessTableRows(
  rows: readonly (readonly string[])[],
  tableBudget: HtmlTableExpansionBudget,
): TableProjection {
  let width = 1;
  for (const row of rows) width = Math.max(width, row.length);
  if (width > parserResourceLimits.maxTableColumns)
    throw new ParserResourceLimitError("HTML table column count");
  if (width * rows.length > parserResourceLimits.maxTableCells)
    throw new ParserResourceLimitError("expanded HTML table cell count");
  if (rows.length === 1) {
    return projectTableRecords({ columns: [], headerRowCount: 0, rows, tableBudget });
  }
  const firstRow = rows[0] ?? [];
  if (looksLikeTableHeader(firstRow, rows.slice(1))) {
    return projectTableRecords({
      columns: firstRow,
      headerRowCount: 1,
      rows: rows.slice(1),
      tableBudget,
    });
  }
  if (looksLikeKeyValueTable(rows)) {
    return projectTableRecords({
      columns: rows.map((row) => row[0] ?? ""),
      headerRowCount: 0,
      mode: "single-record",
      rows: [rows.map((row) => row[1] ?? "")],
      sourceRowCount: rows.length,
      tableBudget,
    });
  }
  return projectTableRecords({
    columns: Array.from({ length: width }, (_, index) => `column_${index + 1}`),
    headerRowCount: 0,
    mode: "record-list",
    rows,
    tableBudget,
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
  const images: MarkdownImageRef[] = [];
  const pending = [{ token, depth: 0 }];
  let count = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const { token: current, depth } = entry;
    if (++count > parserResourceLimits.maxNodes || depth > parserResourceLimits.maxDepth) {
      throw new ParserResourceLimitError("Markdown inline node count or depth");
    }
    const candidate = current as Token & {
      readonly href?: unknown;
      readonly text?: unknown;
      readonly title?: unknown;
      readonly tokens?: readonly Token[];
      readonly items?: readonly Token[];
    };
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
    const children =
      candidate.type === "table"
        ? [...(current as Tokens.Table).header, ...(current as Tokens.Table).rows.flat()].flatMap(
            (cell) => cell.tokens,
          )
        : (candidate.tokens ?? candidate.items ?? []);
    for (const child of [...children].reverse()) {
      pending.push({ token: child, depth: depth + 1 });
    }
  }
  return images;
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
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const currentName = current.name?.toLowerCase();
    if (currentName && ["script", "style", "noscript"].includes(currentName)) continue;
    if (currentName === name) matches.push(current);
    for (const child of [...(current.children ?? [])].reverse()) pending.push(child);
  }
  return matches;
}

function htmlText(node: HtmlNode): string {
  const text: string[] = [];
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const name = current.name?.toLowerCase();
    if (name && ["script", "style", "noscript"].includes(name)) continue;
    if (name === "br") {
      text.push("\n");
      continue;
    }
    if (!current.children?.length) text.push(DomUtils.textContent(current as never));
    else for (const child of [...current.children].reverse()) pending.push(child);
  }
  return text.join("");
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
  return decodeDocumentText(bytes).text;
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
  return createHash("sha256").update(prefix).update(body).digest("hex");
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
      // A transport exception cannot prove whether the synchronous provider accepted the body.
      // Retrying it inline could overlap a remote job that survived the broken connection. Keep
      // the error retryable for the durable runtime, whose protected lease delays any replacement,
      // but reserve immediate client retries for explicit retryable HTTP responses.
      throw new ProviderRequestError("Unstructured parser request failed", {
        cause: error,
        retryable: true,
      });
    }

    // The pinned provider wraps its pre-allocation PDF safety rejection as HTTP 500. Classify
    // that exact, bounded error before retry admission so neither inline nor durable retries
    // repeatedly submit a page that cannot fit. Other failures keep their HTTP semantics.
    const resourceRejection = await classifyUnstructuredResourceResponse(response, signal);
    if (resourceRejection?.kind === "pdf") {
      throw new ProviderInputError(
        "PDF page exceeds safe raster limits. Reduce page dimensions before importing.",
      );
    }
    if (resourceRejection?.kind === "input") {
      throw new ProviderInputError(
        `Unstructured parser resource limit: ${resourceRejection.reason}`,
      );
    }
    if (resourceRejection?.kind === "timeout") {
      throw new ProviderError("Unstructured isolated worker exceeded its execution deadline", {
        code: "provider_timeout",
        requestOutcomeAmbiguous: false,
        retryable: false,
        status: response.status,
      });
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
  heavyMaxConcurrency,
  heavyRequestTimeoutMs,
  maxConcurrency,
  requestTimeoutMs,
}: {
  readonly heavyMaxConcurrency: number;
  readonly heavyRequestTimeoutMs: number;
  readonly maxConcurrency: number;
  readonly requestTimeoutMs: number;
}): void {
  validateUnstructuredConcurrency(maxConcurrency, "maxConcurrency");
  validateUnstructuredConcurrency(heavyMaxConcurrency, "heavyMaxConcurrency");
  if (heavyMaxConcurrency > maxConcurrency) {
    throw new ProviderInputError(
      "Unstructured parser heavyMaxConcurrency must not exceed maxConcurrency",
    );
  }
  validateUnstructuredRequestTimeout(requestTimeoutMs, "requestTimeoutMs");
  validateUnstructuredRequestTimeout(heavyRequestTimeoutMs, "heavyRequestTimeoutMs");
}

function validateUnstructuredConcurrency(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new ProviderInputError(`Unstructured parser ${name} must be an integer between 1 and 32`);
  }
}

function validateUnstructuredRequestTimeout(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxRequestTimeoutMs) {
    throw new ProviderInputError(
      `Unstructured parser ${name} must be an integer between 1 and ${maxRequestTimeoutMs}`,
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
        // A queued waiter can be selected immediately before its last caller cancels. Recheck the
        // admission signal after acquisition so provider work cannot start in that narrow race.
        signal?.throwIfAborted();
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

function createUnstructuredRequestDeadline(requestTimeoutMs: number): UnstructuredRequestDeadline {
  const controller = new AbortController();
  const timeoutReason = new Error("Unstructured parser request deadline exceeded");
  const expiresAt = performance.now() + requestTimeoutMs;
  let expired = false;
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
    },
    expired: () => expired || performance.now() >= expiresAt,
    throwIfExpired: () => {
      // Synchronous normalization can delay timers. Measure elapsed monotonic time as well, so
      // overruns cannot become successful results merely because the timeout callback was late.
      // This detects overruns; a hard CPU cancellation boundary still requires a worker process.
      if (expired || performance.now() >= expiresAt) {
        expired = true;
        controller.abort(timeoutReason);
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
  return status === 408 || status === 425 || status === 429 || status >= 500;
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
