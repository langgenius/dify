import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
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
  readonly language?: string;
  readonly layoutComplexity?: "complex" | "simple";
  readonly requiresOcr?: boolean;
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
  readonly status?: number;

  constructor(
    message: string,
    {
      cause,
      code,
      status,
    }: {
      readonly cause?: unknown;
      readonly code: ProviderErrorCode;
      readonly status?: number;
    },
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
    this.code = code;
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
    super(message, { ...options, code: "provider_rate_limited" });
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderRequestError extends ProviderError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {},
  ) {
    super(message, { ...options, code: "provider_request_failed" });
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
  readonly maxRetries?: number;
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
const defaultMaxResponseBytes = 5 * 1024 * 1024;
const defaultMaxRetries = 0;
const defaultMaxRows = 20_000;
const defaultRetryDelayMs = 100;
const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();

const UnstructuredElementSchema = z.object({
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
      const parserVersion = options.parserVersion ?? "native-markdown@1";
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const text = decodeUtf8(input.body);
      const tokens = marked.lexer(text, { gfm: true });
      const elements = markdownTokensToElements(tokens);

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
      const parserVersion = options.parserVersion ?? "native-html@1";
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const text = decodeUtf8(input.body);
      const document = parseDocument(text, {
        lowerCaseAttributeNames: true,
        lowerCaseTags: true,
      });
      const elements = htmlNodesToElements((document.children ?? []) as HtmlNode[]);

      return createParseArtifact({
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
      const parserVersion = options.parserVersion ?? "native-structured@1";
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
  maxResponseBytes = defaultMaxResponseBytes,
  maxRetries = defaultMaxRetries,
  retryDelayMs = defaultRetryDelayMs,
  sleep = sleepMs,
  ...options
}: UnstructuredParserClientOptions): ParserAdapter {
  validateRetryOptions({ maxRetries, retryDelayMs });

  return {
    kind: "unstructured",
    parse: async (input) => {
      const parserVersion = options.parserVersion ?? "unstructured@1";
      assertInputBounds(input.body, options.maxInputBytes ?? defaultMaxInputBytes);
      const response = await fetchWithRetries({
        buildRequest: () => {
          const form = new FormData();
          const fileBody = input.body.buffer.slice(
            input.body.byteOffset,
            input.body.byteOffset + input.body.byteLength,
          ) as ArrayBuffer;
          form.set("files", new File([fileBody], input.filename, { type: input.mimeType }));

          return new Request(unstructuredPartitionEndpoint(endpoint), {
            body: form,
            method: "POST",
            ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          });
        },
        fetchImpl,
        maxRetries,
        retryDelayMs,
        sleep,
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

      const elements = unstructuredElementsToElements(parsed.data);

      return createParseArtifact({
        elements,
        input,
        kind: "unstructured",
        options,
        parserVersion,
      });
    },
  };
}

function unstructuredPartitionEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");

  return trimmed.endsWith("/general/v0/general") ? trimmed : `${trimmed}/general/v0/general`;
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

  const structuredFormat = structuredDataFormat(input);

  if (structuredFormat && input.body.byteLength > maxNativeInputBytes) {
    return { parser: unstructured, reason: "native-size-limit" };
  }

  if (structured && structuredFormat) {
    return { parser: structured, reason: "structured-file-type" };
  }

  const nativeParser =
    mimeType === "text/markdown" ||
    mimeType === "text/plain" ||
    filename.endsWith(".md") ||
    filename.endsWith(".markdown") ||
    filename.endsWith(".mdx")
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
  elements,
  input,
  kind,
  options,
  parserVersion,
}: {
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
    artifactHash: await artifactHash(parserVersion, input.body),
    contentType: inferContentType(materializedElements),
    createdAt: (options.now ?? defaultNow)(),
    documentAssetId: input.documentAssetId,
    elements: materializedElements,
    id,
    metadata: {
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

  if (
    normalizedMime === "application/json" ||
    normalizedMime === "text/json" ||
    normalizedFilename.endsWith(".json")
  ) {
    return "json";
  }

  if (
    normalizedMime === "application/x-ndjson" ||
    normalizedMime === "application/jsonl" ||
    normalizedFilename.endsWith(".jsonl") ||
    normalizedFilename.endsWith(".ndjson")
  ) {
    return "jsonl";
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
  const tableRows = [
    columns.join(" | "),
    ...rows.map((row) => columns.map((column) => structuredCell(row[column])).join(" | ")),
  ];

  return [
    {
      metadata: {
        columns,
        format,
        rowCount: rows.length,
      },
      sectionPath: [],
      text: tableRows.join("\n"),
      type: "table",
    },
  ];
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

function markdownTokensToElements(tokens: readonly Token[]): ParseElementInput[] {
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
      pushTextElement(elements, "table", markdownTableText(table), sectionPath);
    }
  }

  return elements;
}

function htmlNodesToElements(nodes: readonly HtmlNode[]): ParseElementInput[] {
  const elements: ParseElementInput[] = [];
  const sectionPath: string[] = [];

  for (const node of nodes) {
    visitHtmlNode(node, elements, sectionPath);
  }

  return elements;
}

function visitHtmlNode(node: HtmlNode, elements: ParseElementInput[], sectionPath: string[]): void {
  const name = node.name?.toLowerCase();

  if (name && ["script", "style", "noscript"].includes(name)) {
    return;
  }

  if (name === "title") {
    pushTextElement(elements, "title", htmlText(node), []);
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
    pushTextElement(elements, "table", htmlTableText(node), sectionPath);
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

  for (const sourceElement of sourceElements) {
    const text = normalizeText(sourceElement.text ?? "");
    const type = unstructuredType(sourceElement.type);

    if (!text && !hasUnstructuredVisualMetadata(sourceElement.metadata, type)) {
      continue;
    }

    const pageNumber = sourceElement.metadata.page_number;

    if (text && (type === "title" || type === "heading")) {
      sectionPath.length = 1;
      sectionPath[0] = text;
    }

    elements.push({
      metadata: unstructuredParseElementMetadata({
        metadata: sourceElement.metadata,
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
  text,
  type,
  unstructuredType,
}: {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly type: ParseElement["type"];
  readonly unstructuredType: string | undefined;
}): Record<string, unknown> {
  const { page_number: _pageNumber, ...parsed } = cloneMetadata(metadata);
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
    ...(type === "table" && textAsHtml ? { table: { html: textAsHtml } } : {}),
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

function unstructuredAssetRef(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const uri =
    metadataString(metadata, "image_path") ??
    metadataString(metadata, "image_url") ??
    metadataString(metadata, "url");

  if (!uri) {
    return undefined;
  }

  return {
    ...(metadataString(metadata, "image_mime_type")
      ? { contentType: metadataString(metadata, "image_mime_type") }
      : {}),
    uri,
  };
}

function unstructuredBoundingBox(value: unknown): Record<string, number> | undefined {
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

  return {
    height: maxY - minY,
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

function markdownTableText(table: Tokens.Table): string {
  const header = table.header.map((cell) => normalizeText(cell.text)).join(" | ");
  const rows = table.rows.map((row) => row.map((cell) => normalizeText(cell.text)).join(" | "));

  return [header, ...rows].filter(Boolean).join("\n");
}

function htmlListText(node: HtmlNode): string {
  return (node.children ?? [])
    .filter((child) => child.name?.toLowerCase() === "li")
    .map((child) => normalizeText(htmlText(child)))
    .filter(Boolean)
    .join("\n");
}

function htmlTableText(node: HtmlNode): string {
  const rows = findHtmlElements(node, "tr")
    .map((row) =>
      (row.children ?? [])
        .filter((cell) => ["td", "th"].includes(cell.name?.toLowerCase() ?? ""))
        .map((cell) => normalizeText(htmlText(cell)))
        .join(" | "),
    )
    .filter(Boolean);

  return rows.join("\n");
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

async function artifactHash(parserVersion: string, body: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`${parserVersion}\n`);
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
    throw new ProviderResponseError(
      `Unstructured parser response exceeds maxResponseBytes=${maxResponseBytes}`,
    );
  }

  const body = new Uint8Array(await response.arrayBuffer());

  if (body.byteLength > maxResponseBytes) {
    throw new ProviderResponseError(
      `Unstructured parser response exceeds maxResponseBytes=${maxResponseBytes}`,
    );
  }

  return decodeUtf8(body);
}

async function fetchWithRetries({
  buildRequest,
  fetchImpl,
  maxRetries,
  retryDelayMs,
  sleep,
}: {
  readonly buildRequest: () => Request;
  readonly fetchImpl: typeof fetch;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(buildRequest());

    if (!isRetryableProviderStatus(response.status) || attempt >= maxRetries) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    await sleep(retryDelayMs);
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
