import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOCAL_AUTH_TOKEN = "dev-token";
const DEFAULT_WORKSPACE_SLUG = "workspace";
const WORKSPACE_SLUG_LOOKUP_LIMIT = 100;

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "x-trace-id",
]);
const FORWARDED_RESPONSE_HEADERS = new Set(["cache-control", "content-type", "x-trace-id"]);
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

const FORBIDDEN_ADMIN_IMPORTS = [
  "@knowledge/adapters",
  "@knowledge/api",
  "@knowledge/api-app",
  "@knowledge/compute",
  "@knowledge/database",
  "@knowledge/embeddings",
  "@knowledge/generation",
  "@knowledge/parsers",
] as const;

export interface AdminBffProxyOptions {
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  maxBodyBytes?: number;
}

export interface AdminBffRouteParams {
  path?: string[];
}

export interface ForbiddenAdminImport {
  file: string;
  specifier: string;
}

export interface AdminBffProxy {
  proxy(request: Request, params: AdminBffRouteParams): Promise<Response>;
}

export function createAdminBffProxy(options: AdminBffProxyOptions = {}): AdminBffProxy {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? getAdminBffApiBaseUrl());
  const fetchImpl = options.fetch ?? fetch;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("Admin BFF maxBodyBytes must be a positive integer");
  }

  return {
    async proxy(request, params) {
      const path = params.path ?? [];
      const route = resolveAllowedRoute(request.method, path);
      if (!route) {
        return jsonError("Not Found", 404);
      }

      const upstreamPath = await resolveDefaultWorkspaceSlugPath({
        apiBaseUrl,
        fetchImpl,
        maxBodyBytes,
        path,
        request,
        route,
      });
      if (upstreamPath instanceof Response) {
        return upstreamPath;
      }

      const body = await readBoundedBody(request, maxBodyBytes);
      if (body instanceof Response) {
        return body;
      }

      const sourceUrl = new URL(request.url);
      const upstreamUrl = new URL(upstreamPath, apiBaseUrl);
      upstreamUrl.search = sourceUrl.search;

      try {
        const upstreamRequest = new Request(upstreamUrl, {
          body,
          headers: copyHeadersWithDefaultAuth(request.headers, FORWARDED_REQUEST_HEADERS),
          method: request.method,
        });
        const upstreamResponse = await fetchImpl(upstreamRequest);

        return new Response(upstreamResponse.body, {
          headers: copyHeaders(upstreamResponse.headers, FORWARDED_RESPONSE_HEADERS),
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
        });
      } catch {
        return jsonError("Bad Gateway", 502);
      }
    },
  };
}

async function resolveDefaultWorkspaceSlugPath({
  apiBaseUrl,
  fetchImpl,
  maxBodyBytes,
  path,
  request,
  route,
}: {
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly maxBodyBytes: number;
  readonly path: readonly string[];
  readonly request: Request;
  readonly route: { upstreamPath: string };
}): Promise<string | Response> {
  if (path.length < 3 || path[0] !== "knowledge-spaces" || path[1] !== DEFAULT_WORKSPACE_SLUG) {
    return route.upstreamPath;
  }

  const lookupUrl = new URL("/knowledge-spaces", apiBaseUrl);
  lookupUrl.searchParams.set("limit", String(WORKSPACE_SLUG_LOOKUP_LIMIT));

  let response: Response;
  try {
    response = await fetchImpl(
      new Request(lookupUrl, {
        headers: copyHeadersWithDefaultAuth(request.headers, FORWARDED_REQUEST_HEADERS),
        method: "GET",
      }),
    );
  } catch {
    return jsonError("Bad Gateway", 502);
  }

  if (!response.ok) {
    return new Response(response.body, {
      headers: copyHeaders(response.headers, FORWARDED_RESPONSE_HEADERS),
      status: response.status,
      statusText: response.statusText,
    });
  }

  const payload = await readBoundedJsonResponse(response, maxBodyBytes);
  if (payload instanceof Response) {
    return payload;
  }

  const knowledgeSpaceId = findKnowledgeSpaceIdBySlug(payload, DEFAULT_WORKSPACE_SLUG);
  if (knowledgeSpaceId) {
    const resolvedPath = [...path];
    resolvedPath[1] = knowledgeSpaceId;

    return toUpstreamPath(resolvedPath);
  }

  const created = await createDefaultWorkspace({
    apiBaseUrl,
    fetchImpl,
    maxBodyBytes,
    request,
  });
  if (created instanceof Response) {
    return created;
  }

  const resolvedPath = [...path];
  resolvedPath[1] = created;

  return toUpstreamPath(resolvedPath);
}

async function createDefaultWorkspace({
  apiBaseUrl,
  fetchImpl,
  maxBodyBytes,
  request,
}: {
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly maxBodyBytes: number;
  readonly request: Request;
}): Promise<string | Response> {
  const headers = copyHeadersWithDefaultAuth(request.headers, FORWARDED_REQUEST_HEADERS);
  headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetchImpl(
      new Request(new URL("/knowledge-spaces", apiBaseUrl), {
        body: JSON.stringify({
          name: "Workspace",
          slug: DEFAULT_WORKSPACE_SLUG,
        }),
        headers,
        method: "POST",
      }),
    );
  } catch {
    return jsonError("Bad Gateway", 502);
  }

  if (!response.ok) {
    return new Response(response.body, {
      headers: copyHeaders(response.headers, FORWARDED_RESPONSE_HEADERS),
      status: response.status,
      statusText: response.statusText,
    });
  }

  const payload = await readBoundedJsonResponse(response, maxBodyBytes);
  if (payload instanceof Response) {
    return payload;
  }

  return findKnowledgeSpaceId(payload) ?? jsonError("Knowledge space not found", 404);
}

function findKnowledgeSpaceIdBySlug(payload: unknown, slug: string): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const items = (payload as { readonly items?: unknown }).items;
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as { readonly id?: unknown; readonly slug?: unknown };
    if (record.slug === slug && typeof record.id === "string" && record.id.length > 0) {
      return record.id;
    }
  }

  return null;
}

function findKnowledgeSpaceId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const id = (payload as { readonly id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function listForbiddenAdminImports(
  rootDir = process.cwd(),
): Promise<ForbiddenAdminImport[]> {
  const adminRoot = rootDir.endsWith("apps/admin") ? rootDir : join(rootDir, "apps/admin");
  const files = await listSourceFiles(adminRoot);
  const findings: ForbiddenAdminImport[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const specifier of findImportSpecifiers(source)) {
      if (
        FORBIDDEN_ADMIN_IMPORTS.some(
          (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
        )
      ) {
        findings.push({
          file: relative(adminRoot, file),
          specifier,
        });
      }
    }
  }

  return findings.sort((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(`${right.file}:${right.specifier}`),
  );
}

function getAdminBffApiBaseUrl(): string {
  return (
    readNonEmptyEnv("KNOWLEDGE_API_BASE_URL") ??
    readNonEmptyEnv("NEXT_PUBLIC_API_BASE_URL") ??
    "http://localhost:8788"
  );
}

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Admin BFF apiBaseUrl is required");
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function resolveAllowedRoute(method: string, path: string[]): { upstreamPath: string } | null {
  if (path.length === 0 || path.some((segment) => !SAFE_SEGMENT_PATTERN.test(segment))) {
    return null;
  }

  const normalizedMethod = method.toUpperCase();

  if (path.length === 1 && path[0] === "health" && normalizedMethod === "GET") {
    return { upstreamPath: "/health" };
  }

  if (path.length === 1 && path[0] === "openapi.json" && normalizedMethod === "GET") {
    return { upstreamPath: "/openapi.json" };
  }

  if (
    path.length === 1 &&
    path[0] === "knowledge-spaces" &&
    ["GET", "POST"].includes(normalizedMethod)
  ) {
    return { upstreamPath: "/knowledge-spaces" };
  }

  if (
    path.length === 2 &&
    path[0] === "knowledge-spaces" &&
    ["GET", "PATCH", "DELETE"].includes(normalizedMethod)
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 3 &&
    path[0] === "knowledge-spaces" &&
    ["fsck", "manifest", "status", "staged-commits"].includes(path[2] ?? "") &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "leases" &&
    path[3] === "active" &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "gc" &&
    path[3] === "staged-objects" &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 5 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "gc" &&
    path[3] === "staged-objects" &&
    path[4] === "execute" &&
    normalizedMethod === "POST"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 3 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "golden-questions" &&
    ["GET", "POST"].includes(normalizedMethod)
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "golden-questions" &&
    ["GET", "PATCH", "DELETE"].includes(normalizedMethod)
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 5 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "golden-questions" &&
    path[4] === "annotations" &&
    normalizedMethod === "POST"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 3 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "production-bad-cases" &&
    normalizedMethod === "POST"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "graph" &&
    path[3] === "traverse" &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "fs" &&
    ["cat", "diff", "find", "grep", "ls", "open_node", "stat", "tree"].includes(
      path[3] ?? "",
    ) &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "fs" &&
    ["append", "write"].includes(path[3] ?? "") &&
    normalizedMethod === "POST"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 3 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "documents" &&
    normalizedMethod === "POST"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 4 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "documents" &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 6 &&
    path[0] === "knowledge-spaces" &&
    path[2] === "documents" &&
    path[4] === "parse-artifacts" &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (path.length === 1 && path[0] === "queries" && normalizedMethod === "POST") {
    return { upstreamPath: "/queries" };
  }

  if (path.length === 2 && path[0] === "queries" && normalizedMethod === "GET") {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (
    path.length === 3 &&
    path[0] === "queries" &&
    ["conflicts", "evidence", "missing"].includes(path[2] ?? "") &&
    normalizedMethod === "GET"
  ) {
    return { upstreamPath: toUpstreamPath(path) };
  }

  if (path.length === 2 && path[0] === "traces" && normalizedMethod === "GET") {
    return { upstreamPath: toUpstreamPath(["queries", path[1] ?? ""]) };
  }

  return null;
}

function toUpstreamPath(path: string[]): string {
  return `/${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

async function readBoundedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<ArrayBuffer | null | Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    return null;
  }

  return readBoundedArrayBuffer(request, maxBodyBytes);
}

async function readBoundedArrayBuffer(
  request: Request,
  maxBodyBytes: number,
): Promise<ArrayBuffer | Response> {
  if (!request.body) {
    return new ArrayBuffer(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBodyBytes) {
        await reader.cancel("Admin BFF request body exceeded maxBodyBytes");
        return jsonError("Payload Too Large", 413);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes.buffer;
}

async function readBoundedJsonResponse(
  response: Response,
  maxBodyBytes: number,
): Promise<unknown | Response> {
  if (!response.body) {
    return jsonError("Bad Gateway", 502);
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
      if (totalBytes > maxBodyBytes) {
        await reader.cancel("Admin BFF upstream JSON response exceeded maxBodyBytes");
        return jsonError("Bad Gateway", 502);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return jsonError("Bad Gateway", 502);
  }
}

function copyHeaders(source: Headers, allowlist: Set<string>): Headers {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    if (allowlist.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  return headers;
}

function copyHeadersWithDefaultAuth(source: Headers, allowlist: Set<string>): Headers {
  const headers = copyHeaders(source, allowlist);
  if (!headers.has("authorization")) {
    const token = getDefaultAuthToken();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }
  return headers;
}

function getDefaultAuthToken(): string | null {
  const explicit =
    process.env.KNOWLEDGE_ADMIN_BFF_TOKEN?.trim() || process.env.KNOWLEDGE_DEV_AUTH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  return process.env.NODE_ENV === "production" ? null : DEFAULT_LOCAL_AUTH_TOKEN;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

async function listSourceFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".next" || entry.name === "coverage" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath)));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function findImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?[^"']*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  }

  return [...specifiers].sort();
}
