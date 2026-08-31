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
  readonly defaultLanguage?: string;
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
const defaultRequestTimeoutMs = 120_000;
const maxRequestTimeoutMs = 3_600_000;
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
  defaultLanguage,
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
          const parserVersion = options.parserVersion ?? "unstructured@10";
          const partitionStrategy = unstructuredPartitionStrategy(input);
          const providerImageBlockTypes = unstructuredProviderImageBlockTypes(input);
          const providerLanguage = unstructuredLanguage(
            input.parserHints?.language ?? defaultLanguage,
          );
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
              providerLanguage,
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
              // A client-side abort does not prove that the synchronous Unstructured worker
              // stopped processing. Retrying automatically can overlap the orphaned server-side
              // job and multiply its CPU and memory pressure.
              { cause: error, retryable: false },
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

function unstructuredArtifactHashContext(
  input: ParseDocumentInput,
  request: {
    readonly partitionStrategy: "auto" | "fast" | "hi_res";
    readonly providerImageBlockTypes: readonly ("Image" | "Table")[];
    readonly providerLanguage?: string | undefined;
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
  let selectedMetadataBytes = 0;
  let selectedMetadataCount = 0;

  try {
    const archive = unzipSync(input.body, {
      filter: (file) => {
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
    requestTimeoutMs > maxRequestTimeoutMs
  ) {
    throw new ProviderInputError(
      `Unstructured parser requestTimeoutMs must be an integer between 1 and ${maxRequestTimeoutMs}`,
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
