import React from "react";

import {
  type AdminDocumentAsset,
  type AdminDocumentMultimodalItem,
  type AdminDocumentMultimodalManifest,
  type AdminDocumentOutline,
  type AdminDocumentOutlineNode,
  createAdminApiClient,
  getAdminApiBase,
} from "../../../../lib/api-client";
import { formatBytes } from "../../../../lib/display-format";
import { getAdminServerToken } from "../../../../lib/server-auth";

interface DocumentStatusPageProps {
  readonly params: Promise<{
    readonly documentId: string;
    readonly spaceId: string;
  }>;
}

interface DocumentMultimodalPreview {
  readonly contentType: string;
  readonly dataUrl: string;
  readonly itemId: string;
}

export const dynamic = "force-dynamic";

export default async function DocumentStatusPage({ params }: DocumentStatusPageProps) {
  const { documentId, spaceId } = await params;
  const { asset, multimodal, multimodalPreviews, outline } = await loadDocumentStatus({
    documentId,
    spaceId,
  });

  return (
    <main className="admin-shell single-panel-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Document status</h1>
            <p>Tenant-scoped ingestion state for the selected document.</p>
          </div>
          <a className="button secondary" href="/">
            Back to Admin
          </a>
          <a className="button secondary" href={`/documents/${encodeURIComponent(spaceId)}`}>
            Back to documents
          </a>
        </header>
        <article className="panel">
          {asset ? (
            <DocumentStatusCard asset={asset} />
          ) : (
            <UnavailableDocument documentId={documentId} />
          )}
        </article>
        {asset ? (
          <article className="panel">
            <DocumentOutlineBrowser documentId={documentId} outline={outline} />
          </article>
        ) : null}
        {asset ? (
          <article className="panel">
            <DocumentMultimodalBrowser
              documentId={documentId}
              manifest={multimodal}
              previews={multimodalPreviews}
            />
          </article>
        ) : null}
      </section>
    </main>
  );
}

function DocumentStatusCard({ asset }: { readonly asset: AdminDocumentAsset }) {
  const artifactHref = `/documents/${encodeURIComponent(asset.knowledgeSpaceId)}/${encodeURIComponent(asset.id)}/parse-artifacts/${asset.version}`;

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>{asset.filename}</h2>
          <small className="mono">{asset.id}</small>
        </div>
        <span className={`badge ${asset.parserStatus === "failed" ? "fail" : "ok"}`}>
          {asset.parserStatus}
        </span>
      </div>
      <div className="status-list">
        <div className="status-row">
          <strong>Knowledge space</strong>
          <span className="mono">{asset.knowledgeSpaceId}</span>
        </div>
        <div className="status-row">
          <strong>Size</strong>
          <span>{formatBytes(asset.sizeBytes)}</span>
        </div>
        <div className="status-row">
          <strong>SHA-256</strong>
          <span className="mono">{asset.sha256.slice(0, 12)}</span>
        </div>
        <div className="status-row">
          <strong>Version</strong>
          <span>{asset.version}</span>
        </div>
      </div>
      <div className="button-row">
        <a className="button secondary" href={artifactHref}>
          Open parse artifact
        </a>
      </div>
    </>
  );
}

function UnavailableDocument({ documentId }: { readonly documentId: string }) {
  return (
    <div className="result-card fail">
      <div className="panel-header">
        <div>
          <h2>Document unavailable</h2>
          <small className="mono">{documentId}</small>
        </div>
        <span className="badge fail">not found</span>
      </div>
    </div>
  );
}

function DocumentMultimodalBrowser({
  documentId,
  manifest,
  previews,
}: {
  readonly documentId: string;
  readonly manifest: AdminDocumentMultimodalManifest | null;
  readonly previews: readonly DocumentMultimodalPreview[];
}) {
  if (!manifest) {
    return (
      <>
        <div className="panel-header">
          <div>
            <h2>Multimodal manifest</h2>
            <small className="mono">{documentId}</small>
          </div>
          <span className="badge warn">unavailable</span>
        </div>
        <p className="empty-state">Multimodal inventory has not been materialized.</p>
      </>
    );
  }

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>Multimodal manifest</h2>
          <small className="mono">{manifest.id}</small>
        </div>
        <span className="badge ok">{manifest.items.length} items</span>
      </div>
      <div className="status-list">
        <div className="status-row">
          <strong>Manifest version</strong>
          <span className="mono">{manifest.manifestVersion}</span>
        </div>
        <div className="status-row">
          <strong>Modalities</strong>
          <span>{formatModalityCounts(manifest)}</span>
        </div>
        <div className="status-row">
          <strong>Parse artifact</strong>
          <span className="mono">{manifest.parseArtifactId}</span>
        </div>
        <div className="status-row">
          <strong>Enrichment</strong>
          <span>{formatManifestEnrichment(manifest)}</span>
        </div>
      </div>
      <div className="list-panel" aria-label="Document multimodal inventory">
        {manifest.items.length > 0 ? (
          groupMultimodalItems(manifest.items).map((group) => (
            <React.Fragment key={group.key}>
              <div className="list-row">
                <strong>{group.label}</strong>
                <small className="mono">{group.items.length} resources</small>
                <span>{formatGroupModalities(group.items)}</span>
              </div>
              {group.items.map((item) => (
                <DocumentMultimodalItemRow
                  documentAssetId={manifest.documentAssetId}
                  item={item}
                  knowledgeSpaceId={manifest.knowledgeSpaceId}
                  key={item.id}
                  preview={previews.find((preview) => preview.itemId === item.id)}
                />
              ))}
            </React.Fragment>
          ))
        ) : (
          <p className="empty-state">No table, image, code, or page resources were detected.</p>
        )}
      </div>
    </>
  );
}

function DocumentMultimodalItemRow({
  documentAssetId,
  item,
  knowledgeSpaceId,
  preview,
}: {
  readonly documentAssetId: string;
  readonly item: AdminDocumentMultimodalItem;
  readonly knowledgeSpaceId: string;
  readonly preview?: DocumentMultimodalPreview | undefined;
}) {
  const assetHref = item.assetRef?.objectKey
    ? multimodalAssetHref({ documentAssetId, itemId: item.id, knowledgeSpaceId })
    : null;
  const thumbnailHref = item.assetRef?.variants?.thumbnail?.objectKey
    ? `${multimodalAssetHref({ documentAssetId, itemId: item.id, knowledgeSpaceId })}?variant=thumbnail`
    : null;

  return (
    <div className="list-row">
      {preview ? (
        <img
          alt={item.title ?? item.caption ?? item.modality}
          src={preview.dataUrl}
          style={{
            aspectRatio: "4 / 3",
            borderRadius: 6,
            maxHeight: 120,
            objectFit: "contain",
            width: 160,
          }}
        />
      ) : null}
      <strong>{item.title ?? item.caption ?? item.modality}</strong>
      <small className="mono">
        {item.modality} | {formatSectionPath(item.sectionPath)} | {item.parseElementId}
      </small>
      <span>
        {formatMultimodalItemLocation(item)} | {formatEnrichment(item.enrichment)} |{" "}
        {formatMultimodalAssetState(item)}
      </span>
      {formatProviderState(item) ? <span>{formatProviderState(item)}</span> : null}
      {assetHref ? (
        <span>
          <a href={assetHref}>Open asset</a>
          {thumbnailHref ? (
            <>
              {" "}
              | <a href={thumbnailHref}>Open thumbnail</a>
            </>
          ) : null}
        </span>
      ) : null}
      <span>{item.textPreview ?? item.ocrText ?? "Preview pending"}</span>
    </div>
  );
}

function DocumentOutlineBrowser({
  documentId,
  outline,
}: {
  readonly documentId: string;
  readonly outline: AdminDocumentOutline | null;
}) {
  if (!outline) {
    return (
      <>
        <div className="panel-header">
          <div>
            <h2>Document outline</h2>
            <small className="mono">{documentId}</small>
          </div>
          <span className="badge warn">unavailable</span>
        </div>
        <p className="empty-state">Outline has not been materialized for this document version.</p>
      </>
    );
  }

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>Document outline</h2>
          <small className="mono">{outline.id}</small>
        </div>
        <span className="badge ok">v{outline.version}</span>
      </div>
      <div className="status-list">
        <div className="status-row">
          <strong>Outline version</strong>
          <span className="mono">{outline.outlineVersion}</span>
        </div>
        <div className="status-row">
          <strong>Parse artifact</strong>
          <span className="mono">{outline.parseArtifactId}</span>
        </div>
        <div className="status-row">
          <strong>Nodes</strong>
          <span>{countOutlineNodes(outline.nodes)}</span>
        </div>
        <div className="status-row">
          <strong>Quality</strong>
          <span>{formatOutlineQuality(outline)}</span>
        </div>
      </div>
      <div className="list-panel" aria-label="Document outline tree">
        {outline.nodes.length > 0 ? (
          outline.nodes.map((node) => (
            <DocumentOutlineNodeRow depth={0} key={node.id} node={node} />
          ))
        ) : (
          <p className="empty-state">No outline nodes were returned.</p>
        )}
      </div>
    </>
  );
}

function DocumentOutlineNodeRow({
  depth,
  node,
}: {
  readonly depth: number;
  readonly node: AdminDocumentOutlineNode;
}) {
  return (
    <>
      <div
        aria-level={Math.max(1, node.level)}
        className="list-row"
        role="treeitem"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <strong>{node.title}</strong>
        <small className="mono">{formatSectionPath(node.sectionPath)}</small>
        <span>
          {formatPageRange(node)}
          {formatOffsetRange(node)}
          {formatTitleLocation(node)}
        </span>
        <span>{node.summary ?? "Summary pending"}</span>
      </div>
      {node.children.map((child) => (
        <DocumentOutlineNodeRow depth={depth + 1} key={child.id} node={child} />
      ))}
    </>
  );
}

function formatSectionPath(sectionPath: readonly string[]): string {
  return sectionPath.length > 0 ? sectionPath.join(" / ") : "Document";
}

function formatPageRange(node: AdminDocumentOutlineNode): string {
  if (node.startPage === undefined) {
    return "Page unknown";
  }

  if (node.endPage !== undefined && node.endPage !== node.startPage) {
    return `Pages ${node.startPage}-${node.endPage}`;
  }

  return `Page ${node.startPage}`;
}

function formatOffsetRange(node: AdminDocumentOutlineNode): string {
  if (node.startOffset === undefined) {
    return "";
  }

  if (node.endOffset !== undefined && node.endOffset !== node.startOffset) {
    return ` | Offset ${node.startOffset}-${node.endOffset}`;
  }

  return ` | Offset ${node.startOffset}`;
}

function formatTitleLocation(node: AdminDocumentOutlineNode): string {
  if (!node.titleLocation) {
    return ` | TOC ${node.tocSource}`;
  }

  const page =
    node.titleLocation.pageNumber === undefined ? "" : ` page ${node.titleLocation.pageNumber}`;
  const offset =
    node.titleLocation.startOffset === undefined ? "" : ` offset ${node.titleLocation.startOffset}`;
  return ` | Title ${node.titleLocation.source}${page}${offset}`;
}

function countOutlineNodes(nodes: readonly AdminDocumentOutlineNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countOutlineNodes(node.children), 0);
}

function formatOutlineQuality(outline: AdminDocumentOutline): string {
  const quality = recordValue(outline.metadata.quality);
  if (!quality) {
    return "not reported";
  }

  const fallbackNodeCount = numberValue(quality.fallbackNodeCount);
  const headingCoverageRatio = numberValue(quality.headingCoverageRatio);
  const titleCoverageRatio = numberValue(quality.titleLocationCoverageRatio);

  return [
    fallbackNodeCount === undefined ? undefined : `${fallbackNodeCount} fallback`,
    headingCoverageRatio === undefined
      ? undefined
      : `${Math.round(headingCoverageRatio * 100)}% headings`,
    titleCoverageRatio === undefined
      ? undefined
      : `${Math.round(titleCoverageRatio * 100)}% titles`,
  ]
    .filter((item): item is string => item !== undefined)
    .join(" | ");
}

function formatModalityCounts(manifest: AdminDocumentMultimodalManifest): string {
  const counts = recordValue(manifest.metadata.modalityCounts);

  if (!counts) {
    return "not reported";
  }

  return ["table", "image", "code", "page"]
    .map((modality) => `${modality}:${numberValue(counts[modality]) ?? 0}`)
    .join(" | ");
}

function formatManifestEnrichment(manifest: AdminDocumentMultimodalManifest): string {
  const enrichment = recordValue(manifest.metadata.enrichment);
  if (!enrichment) {
    return "not reported";
  }

  const budget = recordValue(enrichment.providerBudget);
  const budgetText =
    budget &&
    (numberValue(budget.maxItems) !== undefined ||
      numberValue(budget.maxSourceTextChars) !== undefined)
      ? `budget ${numberValue(budget.maxItems) ?? "?"} items / ${
          numberValue(budget.maxSourceTextChars) ?? "?"
        } chars`
      : undefined;

  return [
    stringValue(enrichment.source),
    stringValue(enrichment.model),
    numberValue(enrichment.attemptedItems) === undefined
      ? undefined
      : `${numberValue(enrichment.attemptedItems)} attempted`,
    numberValue(enrichment.skippedItems) === undefined
      ? undefined
      : `${numberValue(enrichment.skippedItems)} skipped`,
    numberValue(enrichment.failedItems) === undefined
      ? undefined
      : `${numberValue(enrichment.failedItems)} failed`,
    budgetText,
  ]
    .filter((item): item is string => item !== undefined && item.length > 0)
    .join(" | ");
}

function formatEnrichment(enrichment: Readonly<Record<string, string>>): string {
  return Object.entries(enrichment)
    .filter(([, value]) => value !== "unsupported")
    .map(([key, value]) => `${key}:${value}`)
    .join(" | ");
}

function formatMultimodalAssetState(item: AdminDocumentMultimodalItem): string {
  if (item.assetRef?.objectKey) {
    return "Asset ready";
  }

  if (item.assetRef?.uri) {
    return "External asset";
  }

  return "No asset";
}

function formatMultimodalItemLocation(item: AdminDocumentMultimodalItem): string {
  const parts = [
    item.pageNumber === undefined ? "Page unknown" : `Page ${item.pageNumber}`,
    formatMultimodalOffsetRange(item),
    formatBoundingBox(item),
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return parts.join(" | ");
}

function formatMultimodalOffsetRange(item: AdminDocumentMultimodalItem): string | undefined {
  if (item.startOffset === undefined) {
    return undefined;
  }

  if (item.endOffset !== undefined && item.endOffset !== item.startOffset) {
    return `Offset ${item.startOffset}-${item.endOffset}`;
  }

  return `Offset ${item.startOffset}`;
}

function formatBoundingBox(item: AdminDocumentMultimodalItem): string | undefined {
  if (!item.boundingBox) {
    return undefined;
  }

  const { height, width, x, y } = item.boundingBox;
  return `Bbox x:${x} y:${y} w:${width} h:${height}`;
}

function formatProviderState(item: AdminDocumentMultimodalItem): string | undefined {
  const enrichment = recordValue(item.sourceMetadata.enrichment);
  if (!enrichment) {
    return undefined;
  }

  const status = stringValue(enrichment.status);
  const provider = stringValue(enrichment.provider);
  const task = stringValue(enrichment.task);
  const error = stringValue(enrichment.error);

  if (status === "failed") {
    return `Provider failed${provider ? ` (${provider})` : ""}${task ? ` ${task}` : ""}${
      error ? `: ${error}` : ""
    }`;
  }

  if (status) {
    return `Provider ${status}${provider ? ` (${provider})` : ""}${task ? ` ${task}` : ""}`;
  }

  return undefined;
}

function groupMultimodalItems(items: readonly AdminDocumentMultimodalItem[]): ReadonlyArray<{
  readonly items: readonly AdminDocumentMultimodalItem[];
  readonly key: string;
  readonly label: string;
}> {
  const groups = new Map<string, AdminDocumentMultimodalItem[]>();

  for (const item of items) {
    const page = item.pageNumber === undefined ? "Page unknown" : `Page ${item.pageNumber}`;
    const section = formatSectionPath(item.sectionPath);
    const key = `${page}\u0000${section}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()].map(([key, groupItems]) => {
    const [page = "Page unknown", section = "Document"] = key.split("\u0000");
    return {
      items: groupItems,
      key,
      label: `${page} / ${section}`,
    };
  });
}

function formatGroupModalities(items: readonly AdminDocumentMultimodalItem[]): string {
  const counts: Record<AdminDocumentMultimodalItem["modality"], number> = {
    code: 0,
    image: 0,
    page: 0,
    table: 0,
  };

  for (const item of items) {
    counts[item.modality] += 1;
  }

  return (["table", "image", "code", "page"] as const)
    .filter((modality) => counts[modality] > 0)
    .map((modality) => `${modality}:${counts[modality]}`)
    .join(" | ");
}

function multimodalAssetHref({
  documentAssetId,
  itemId,
  knowledgeSpaceId,
}: {
  readonly documentAssetId: string;
  readonly itemId: string;
  readonly knowledgeSpaceId: string;
}): string {
  return `/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/documents/${encodeURIComponent(documentAssetId)}/multimodal/${encodeURIComponent(itemId)}/asset`;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function loadDocumentStatus({
  documentId,
  spaceId,
}: {
  readonly documentId: string;
  readonly spaceId: string;
}): Promise<{
  readonly asset: AdminDocumentAsset | null;
  readonly multimodal: AdminDocumentMultimodalManifest | null;
  readonly multimodalPreviews: readonly DocumentMultimodalPreview[];
  readonly outline: AdminDocumentOutline | null;
}> {
  const token = getAdminServerToken();
  if (!token) {
    return { asset: null, multimodal: null, multimodalPreviews: [], outline: null };
  }

  const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
  const [asset, outline, multimodal] = await Promise.all([
    client.getDocument({ documentId, knowledgeSpaceId: spaceId, token }).catch(() => null),
    client.getDocumentOutline({ documentId, knowledgeSpaceId: spaceId, token }).catch(() => null),
    client
      .getDocumentMultimodalManifest({ documentId, knowledgeSpaceId: spaceId, token })
      .catch(() => null),
  ]);
  const multimodalPreviews = multimodal
    ? await loadDocumentMultimodalPreviews({
        client,
        documentId,
        manifest: multimodal,
        spaceId,
        token,
      })
    : [];

  return { asset, multimodal, multimodalPreviews, outline };
}

async function loadDocumentMultimodalPreviews({
  client,
  documentId,
  manifest,
  spaceId,
  token,
}: {
  readonly client: ReturnType<typeof createAdminApiClient>;
  readonly documentId: string;
  readonly manifest: AdminDocumentMultimodalManifest;
  readonly spaceId: string;
  readonly token: string;
}): Promise<DocumentMultimodalPreview[]> {
  const previewItems = manifest.items
    .filter((item) => item.modality === "image" && item.assetRef?.objectKey)
    .slice(0, 6);
  const previews = await Promise.all(
    previewItems.map(async (item): Promise<DocumentMultimodalPreview | null> => {
      const asset = await client
        .getDocumentMultimodalAsset({
          documentId,
          itemId: item.id,
          knowledgeSpaceId: spaceId,
          token,
          ...(item.assetRef?.variants?.thumbnail?.objectKey ? { variant: "thumbnail" } : {}),
        })
        .catch(() => null);

      if (!asset?.contentType.startsWith("image/")) {
        return null;
      }

      return {
        contentType: asset.contentType,
        dataUrl: `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`,
        itemId: item.id,
      };
    }),
  );

  return previews.filter((preview): preview is DocumentMultimodalPreview => preview !== null);
}
