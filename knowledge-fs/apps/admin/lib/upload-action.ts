import { createAdminBffProxy } from "./bff";

const DEFAULT_MAX_UPLOAD_REDIRECT_JSON_BYTES = 1024 * 1024;
const textDecoder = new TextDecoder();

export interface UploadDocumentRedirectHandlerOptions {
  readonly apiBaseUrl?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly maxBodyBytes?: number | undefined;
  readonly maxJsonBytes?: number | undefined;
}

export interface UploadDocumentRedirectHandler {
  handle(request: Request): Promise<Response>;
}

interface UploadedDocumentAsset {
  readonly filename: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly parserStatus: "failed" | "parsed" | "pending";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly version: number;
}

export function createUploadDocumentRedirectHandler(
  options: UploadDocumentRedirectHandlerOptions = {},
): UploadDocumentRedirectHandler {
  const proxyOptions: Parameters<typeof createAdminBffProxy>[0] = {};
  if (options.apiBaseUrl !== undefined) {
    proxyOptions.apiBaseUrl = options.apiBaseUrl;
  }
  if (options.fetch !== undefined) {
    proxyOptions.fetch = options.fetch;
  }
  if (options.maxBodyBytes !== undefined) {
    proxyOptions.maxBodyBytes = options.maxBodyBytes;
  }

  const proxy = createAdminBffProxy(proxyOptions);
  const maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_UPLOAD_REDIRECT_JSON_BYTES;

  if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1) {
    throw new Error("Upload redirect maxJsonBytes must be a positive integer");
  }

  return {
    async handle(request) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return redirectWithError(request, "Upload form data is invalid");
      }

      const knowledgeSpaceId = stringField(formData, "knowledgeSpaceId");
      if (!knowledgeSpaceId) {
        return redirectWithError(request, "Knowledge space is required");
      }

      const file = formData.get("file");
      if (!(file instanceof File) || file.size < 1) {
        return redirectWithError(request, "Document file is required");
      }

      const upstreamFormData = new FormData();
      upstreamFormData.set("file", file);

      const sourceId = stringField(formData, "sourceId");
      if (sourceId) {
        upstreamFormData.set("sourceId", sourceId);
      }

      const proxyResponse = await proxy.proxy(
        new Request(
          new URL(
            `/api/bff/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/documents`,
            request.url,
          ),
          {
            body: upstreamFormData,
            headers: copyForwardHeaders(request.headers),
            method: "POST",
          },
        ),
        { path: ["knowledge-spaces", knowledgeSpaceId, "documents"] },
      );

      if (!proxyResponse.ok) {
        return redirectWithError(request, await readErrorMessage(proxyResponse, maxJsonBytes));
      }

      try {
        const asset = parseUploadedDocumentAsset(
          await readBoundedJson(proxyResponse, maxJsonBytes),
        );
        return redirectWithAsset(request, asset);
      } catch {
        return redirectWithError(request, "Document upload response is invalid");
      }
    },
  };
}

function redirectWithAsset(request: Request, asset: UploadedDocumentAsset): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("uploadStatus", "success");
  url.searchParams.set("spaceId", asset.knowledgeSpaceId);
  url.searchParams.set("documentId", asset.id);
  url.searchParams.set("filename", asset.filename);
  url.searchParams.set("parserStatus", asset.parserStatus);
  url.searchParams.set("sizeBytes", String(asset.sizeBytes));
  url.searchParams.set("sha256", asset.sha256);
  url.searchParams.set("version", String(asset.version));

  return Response.redirect(url, 303);
}

function redirectWithError(request: Request, message: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("uploadStatus", "error");
  url.searchParams.set("uploadError", message);

  return Response.redirect(url, 303);
}

function parseUploadedDocumentAsset(value: unknown): UploadedDocumentAsset {
  if (!value || typeof value !== "object") {
    throw new Error("Document upload response is invalid");
  }

  const record = value as Record<string, unknown>;
  const filename = record.filename;
  const id = record.id;
  const knowledgeSpaceId = record.knowledgeSpaceId;
  const parserStatus = record.parserStatus;
  const sha256 = record.sha256;
  const sizeBytes = record.sizeBytes;
  const version = record.version;

  if (
    typeof filename !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof sha256 !== "string" ||
    !Number.isInteger(sizeBytes) ||
    !Number.isInteger(version) ||
    (parserStatus !== "pending" && parserStatus !== "parsed" && parserStatus !== "failed")
  ) {
    throw new Error("Document upload response is invalid");
  }

  return {
    filename,
    id,
    knowledgeSpaceId,
    parserStatus,
    sha256,
    sizeBytes: Number(sizeBytes),
    version: Number(version),
  };
}

async function readErrorMessage(response: Response, maxJsonBytes: number): Promise<string> {
  try {
    const payload = await readBoundedJson(response, maxJsonBytes);
    if (payload && typeof payload === "object") {
      const error = (payload as { readonly error?: unknown }).error;
      if (typeof error === "string" && error.trim()) {
        return error;
      }
    }
  } catch {
    // Fall through to generic bounded status message.
  }

  if (response.status === 404) {
    return "Knowledge API upload route was not found; check KNOWLEDGE_API_BASE_URL/NEXT_PUBLIC_API_BASE_URL and API startup";
  }

  return `Document upload failed with status ${response.status}`;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const body = response.body;
  if (!body) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = value;
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Upload redirect JSON response exceeds maxJsonBytes=${maxBytes}`);
    }
    chunks.push(bytes);
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(textDecoder.decode(payload));
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function copyForwardHeaders(headers: Headers): Headers {
  const forwarded = new Headers();
  const authorization = headers.get("authorization");
  if (authorization) {
    forwarded.set("authorization", authorization);
  }

  return forwarded;
}
