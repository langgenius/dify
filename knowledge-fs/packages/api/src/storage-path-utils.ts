import type { ResourceMount } from "@knowledge/core";

export function sourcePointerToObjectPrefix(
  mount: Pick<ResourceMount, "provider" | "sourcePointer">,
): string {
  const allowedProvider = mount.provider === "upload" || mount.provider === "object-storage";

  if (!allowedProvider) {
    throw new Error(`SourceFS provider ${mount.provider} is not supported`);
  }

  const prefix =
    mount.sourcePointer.startsWith("upload://") || mount.sourcePointer.startsWith("object://")
      ? mount.sourcePointer.replace(/^[^:]+:\/\//u, "")
      : null;

  if (!prefix) {
    throw new Error("SourceFS mount sourcePointer must use upload:// or object://");
  }

  return ensureTrailingSlash(prefix.replace(/^\/+/u, ""));
}

export function sourceObjectKeyForPath({
  objectPrefix,
  relativePath,
}: {
  readonly objectPrefix: string;
  readonly relativePath: string;
}): string {
  return `${objectPrefix}${relativePath}`;
}

export function sourceVirtualPathForObjectKey({
  mountPath,
  objectKey,
  objectPrefix,
}: {
  readonly mountPath: string;
  readonly objectKey: string;
  readonly objectPrefix: string;
}): string {
  const relativePath = objectKey.slice(objectPrefix.length);

  return `${normalizeSourceFsPath(mountPath)}/${relativePath}`;
}

export function sourceRelativePath(path: string, mountPath: string): string {
  const normalizedPath = normalizeSourceFsPath(path);
  const normalizedMountPath = normalizeSourceFsPath(mountPath);

  if (normalizedPath === normalizedMountPath) {
    return "";
  }

  return normalizedPath.slice(normalizedMountPath.length + 1);
}

export function sourcePathIsWithinMount(path: string, mountPath: string): boolean {
  const normalizedPath = normalizeSourceFsPath(path);
  const normalizedMountPath = normalizeSourceFsPath(mountPath);

  return (
    normalizedPath === normalizedMountPath || normalizedPath.startsWith(`${normalizedMountPath}/`)
  );
}

export function normalizeSourceFsPath(path: string): string {
  const normalized = path.length > 1 ? path.replace(/\/+$/u, "") : path;

  if (!normalized.startsWith("/sources")) {
    throw new Error("SourceFS path must be under /sources");
  }

  const segments = normalized.split("/").filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("SourceFS path must not contain traversal segments");
  }

  return normalized;
}

export function createDocumentObjectKey({
  assetId,
  filename,
  knowledgeSpaceId,
  tenantId,
}: {
  readonly assetId: string;
  readonly filename: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}): string {
  return `${tenantId}/spaces/${knowledgeSpaceId}/documents/${assetId}/${sanitizeFilename(
    filename,
  )}`;
}

export function createDocumentMultimodalAssetObjectKey({
  assetId,
  contentType,
  elementId,
  knowledgeSpaceId,
  sha256,
  tenantId,
}: {
  readonly assetId: string;
  readonly contentType: string;
  readonly elementId: string;
  readonly knowledgeSpaceId: string;
  readonly sha256: string;
  readonly tenantId: string;
}): string {
  const extension = imageExtension(contentType);
  const safeElementId = sanitizeFilename(elementId).replace(/\.[a-z0-9]+$/u, "") || "asset";

  return `${tenantId}/spaces/${knowledgeSpaceId}/documents/${assetId}/assets/${safeElementId}-${sha256.slice(0, 12)}.${extension}`;
}

export function createDocumentMultimodalAssetVariantObjectKey({
  assetId,
  contentType,
  elementId,
  knowledgeSpaceId,
  sha256,
  tenantId,
  variant,
}: {
  readonly assetId: string;
  readonly contentType: string;
  readonly elementId: string;
  readonly knowledgeSpaceId: string;
  readonly sha256: string;
  readonly tenantId: string;
  readonly variant: string;
}): string {
  const extension = imageExtension(contentType);
  const safeElementId = sanitizeFilename(elementId).replace(/\.[a-z0-9]+$/u, "") || "asset";
  const safeVariant = sanitizeFilename(variant).replace(/\.[a-z0-9]+$/u, "") || "variant";

  return `${tenantId}/spaces/${knowledgeSpaceId}/documents/${assetId}/assets/${safeElementId}-${safeVariant}-${sha256.slice(0, 12)}.${extension}`;
}

export function sanitizeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop()?.trim().toLowerCase() ?? "";
  const safe = basename
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "upload";
}

function imageExtension(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/avif":
      return "avif";
    case "image/bmp":
      return "bmp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/svg+xml":
      return "svg";
    case "image/tiff":
      return "tiff";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
