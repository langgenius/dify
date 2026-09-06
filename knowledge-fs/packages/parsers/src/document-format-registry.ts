/** One source of truth for upload MIME aliases and parser family. Internal source formats do not widen uploads. */
export const DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION = {
  csv: ["text/csv", "application/vnd.ms-excel"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  eml: ["message/rfc822"],
  epub: ["application/epub+zip"],
  htm: ["text/html"],
  html: ["text/html"],
  json: ["application/json"],
  jsonl: ["application/x-ndjson", "application/jsonl", "application/ndjson", "application/json"],
  markdown: ["text/markdown", "text/x-markdown", "text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  mdx: ["text/mdx", "text/markdown", "text/plain"],
  msg: ["application/vnd.ms-outlook", "application/x-msg"],
  odt: ["application/vnd.oasis.opendocument.text"],
  pdf: ["application/pdf"],
  ppt: ["application/vnd.ms-powerpoint", "application/mspowerpoint", "application/x-mspowerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  properties: ["text/x-java-properties", "text/plain"],
  rtf: ["application/rtf", "text/rtf", "application/x-rtf"],
  text: ["text/plain"],
  txt: ["text/plain"],
  vtt: ["text/vtt", "text/plain"],
  xls: [
    "application/vnd.ms-excel",
    "application/excel",
    "application/x-excel",
    "application/x-msexcel",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xml: ["application/xml", "text/xml"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type DocumentFormat =
  | "csv"
  | "html"
  | "json"
  | "jsonl"
  | "markdown"
  | "properties"
  | "unstructured"
  | "vtt"
  | "xml"
  | "yaml";
const formatsByExtension: Readonly<Record<string, DocumentFormat>> = {
  csv: "csv",
  doc: "unstructured",
  docx: "unstructured",
  eml: "unstructured",
  epub: "unstructured",
  htm: "html",
  html: "html",
  json: "json",
  jsonl: "jsonl",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  msg: "unstructured",
  odt: "unstructured",
  pdf: "unstructured",
  ppt: "unstructured",
  pptx: "unstructured",
  properties: "properties",
  rtf: "unstructured",
  text: "markdown",
  txt: "markdown",
  vtt: "vtt",
  xls: "unstructured",
  xlsx: "unstructured",
  xml: "xml",
  // Source connectors historically support these; upload admission deliberately remains unchanged.
  ndjson: "jsonl",
  yaml: "yaml",
  yml: "yaml",
};

const formatsByMime = new Map<string, DocumentFormat>();
for (const [extension, mimes] of Object.entries(DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION)) {
  const format = formatsByExtension[extension];
  if (format) for (const mime of mimes) formatsByMime.set(mime, format);
}
// Ambiguous upload aliases must not change generic MIME routing (CSV may be declared Excel).
formatsByMime.set("text/plain", "markdown");
formatsByMime.set("text/markdown", "markdown");
formatsByMime.set("application/json", "json");
formatsByMime.set("application/xhtml+xml", "html");
formatsByMime.set("text/json", "json");
for (const mime of ["application/yaml", "text/yaml", "application/x-yaml"])
  formatsByMime.set(mime, "yaml");

export function documentExtension(filename: string): string | undefined {
  const normalized = filename.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 && dot < normalized.length - 1 ? normalized.slice(dot + 1) : undefined;
}

export function resolveDocumentFormat(input: {
  readonly filename: string;
  readonly mimeType: string;
}): DocumentFormat | null {
  const extension = documentExtension(input.filename);
  const byExtension =
    extension && Object.hasOwn(formatsByExtension, extension)
      ? formatsByExtension[extension]
      : undefined;
  return (
    byExtension ??
    formatsByMime.get(input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "") ??
    null
  );
}

export function documentMimeTypesForFilename(filename: string): readonly string[] | undefined {
  const extension = documentExtension(filename);
  const registry: Readonly<Record<string, readonly string[]>> =
    DOCUMENT_UPLOAD_MIME_TYPES_BY_EXTENSION;
  return extension && Object.hasOwn(registry, extension) ? registry[extension] : undefined;
}
