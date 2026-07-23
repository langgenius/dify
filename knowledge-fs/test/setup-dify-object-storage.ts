import { beforeEach } from "vitest";

interface StoredObject {
  readonly body: Uint8Array;
  readonly checksumSha256Base64?: string | undefined;
  readonly contentType?: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
}

const objects = new Map<string, StoredObject>();
const metadataHeader = "X-Knowledge-FS-Metadata";
const checksumHeader = "X-Knowledge-FS-Checksum-Sha256";
const contentTypeHeader = "X-Knowledge-FS-Content-Type";

const difyObjectStorageFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/inner/api/knowledge-fs/storage/")) {
    throw new Error(`Unexpected test fetch request: ${request.method} ${url.href}`);
  }

  if (url.pathname === "/inner/api/knowledge-fs/storage/health") {
    return Response.json({ ok: true });
  }

  if (url.pathname === "/inner/api/knowledge-fs/storage/objects") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const cursor = url.searchParams.get("cursor");
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
    const keys = [...objects.keys()]
      .filter((key) => key.startsWith(prefix) && (!cursor || key > cursor))
      .sort();
    const selected = keys.slice(0, limit);
    const hasMore = keys.length > selected.length;
    return Response.json({
      ...(hasMore && selected.length > 0 ? { nextCursor: selected.at(-1) } : {}),
      objects: selected.map((key) => metadata(key, requiredObject(key))),
    });
  }

  const key = url.searchParams.get("key");
  if (!key) return Response.json({ error: "missing key" }, { status: 400 });

  if (url.pathname === "/inner/api/knowledge-fs/storage/object/metadata") {
    const stored = objects.get(key);
    return stored
      ? Response.json(metadata(key, stored))
      : Response.json({ error: "not found" }, { status: 404 });
  }

  if (url.pathname !== "/inner/api/knowledge-fs/storage/object") {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    objects.delete(key);
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET") {
    const stored = objects.get(key);
    return stored
      ? new Response(stored.body.slice(), {
          headers: stored.contentType ? { "content-type": stored.contentType } : {},
        })
      : Response.json({ error: "not found" }, { status: 404 });
  }
  if (request.method === "PUT") {
    const body = new Uint8Array(await request.arrayBuffer());
    const stored: StoredObject = {
      body,
      metadata: decodeMetadata(request.headers.get(metadataHeader)),
      ...(request.headers.get(checksumHeader)
        ? { checksumSha256Base64: request.headers.get(checksumHeader) ?? undefined }
        : {}),
      ...(request.headers.get(contentTypeHeader)
        ? { contentType: request.headers.get(contentTypeHeader) ?? undefined }
        : {}),
    };
    objects.set(key, stored);
    return Response.json(metadata(key, stored));
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
};

globalThis.fetch = difyObjectStorageFetch;

beforeEach(() => {
  objects.clear();
  globalThis.fetch = difyObjectStorageFetch;
});

function requiredObject(key: string): StoredObject {
  const stored = objects.get(key);
  if (!stored) throw new Error(`Missing test object ${key}`);
  return stored;
}

function metadata(key: string, stored: StoredObject) {
  return {
    ...(stored.checksumSha256Base64
      ? { checksumSha256Base64: stored.checksumSha256Base64 }
      : {}),
    ...(stored.contentType ? { contentType: stored.contentType } : {}),
    key,
    metadata: stored.metadata,
    sizeBytes: stored.body.byteLength,
  };
}

function decodeMetadata(value: string | null): Readonly<Record<string, string>> {
  if (!value) return {};
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const parsed: unknown = JSON.parse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid test object metadata");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => {
      if (typeof item !== "string") throw new Error("Invalid test object metadata");
      return [key, item];
    }),
  );
}
