import React from "react";

import {
  type AdminDocumentAsset,
  type AdminDocumentAssetList,
  createAdminApiClient,
  getAdminApiBase,
} from "../../../lib/api-client";
import { formatBytes } from "../../../lib/display-format";
import { adminRowKey } from "../../../lib/graph-row-keys";
import { getAdminServerToken } from "../../../lib/server-auth";

interface DocumentListPageProps {
  readonly params: Promise<{
    readonly spaceId: string;
  }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function DocumentListPage({ params, searchParams }: DocumentListPageProps) {
  const { spaceId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const cursor = firstSearchParam(resolvedSearchParams.cursor);
  const list = await loadDocumentList({ cursor, spaceId });

  return (
    <main className="admin-shell single-panel-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Documents</h1>
            <p>Published document resources for the selected KnowledgeSpace.</p>
          </div>
          <a className="button secondary" href="/">
            Back to Admin
          </a>
        </header>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Document list</h2>
              <small className="mono">{spaceId}</small>
            </div>
            <span className={`badge ${list ? "ok" : "warn"}`}>{list ? "Live" : "Unavailable"}</span>
          </div>
          {list ? <DocumentList list={list} spaceId={spaceId} /> : <UnavailableDocumentList />}
        </article>
      </section>
    </main>
  );
}

function DocumentList({
  list,
  spaceId,
}: { readonly list: AdminDocumentAssetList; readonly spaceId: string }) {
  if (list.items.length === 0) {
    return (
      <div className="status-list">
        <div className="status-row">
          <strong>Status</strong>
          <span>No documents found</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table" aria-label={`Documents ${spaceId}`}>
        <div className="table-row">
          <strong>Document</strong>
          <span>{list.nextCursor ? "More available" : `${list.items.length} documents`}</span>
        </div>
        {list.items.map((asset, index) => (
          <DocumentListRow
            asset={asset}
            key={adminRowKey("document-asset", asset.id, index)}
            spaceId={spaceId}
          />
        ))}
      </div>
      {list.nextCursor ? (
        <div className="button-row">
          <a
            className="button secondary"
            href={`/documents/${encodeURIComponent(spaceId)}?cursor=${encodeURIComponent(list.nextCursor)}`}
          >
            Next page
          </a>
        </div>
      ) : null}
    </>
  );
}

function DocumentListRow({
  asset,
  spaceId,
}: {
  readonly asset: AdminDocumentAsset;
  readonly spaceId: string;
}) {
  const documentHref = `/documents/${encodeURIComponent(spaceId)}/${encodeURIComponent(asset.id)}`;

  return (
    <div className="table-row">
      <div>
        <a href={documentHref}>
          <strong>{asset.filename}</strong>
        </a>
        <div className="mono">{asset.id}</div>
        <div className="mono">{asset.objectKey}</div>
      </div>
      <span>{`${asset.parserStatus} / ${formatBytes(asset.sizeBytes)} / v${asset.version}`}</span>
    </div>
  );
}

function UnavailableDocumentList() {
  return (
    <div className="result-card fail">
      <div className="panel-header">
        <div>
          <h2>Document list unavailable</h2>
          <small>Admin could not load the published document view.</small>
        </div>
        <span className="badge fail">unavailable</span>
      </div>
    </div>
  );
}

async function loadDocumentList({
  cursor,
  spaceId,
}: {
  readonly cursor?: string | undefined;
  readonly spaceId: string;
}): Promise<AdminDocumentAssetList | null> {
  const token = getAdminServerToken();
  if (!token) {
    return null;
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    return await client.listDocuments({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: spaceId,
      limit: 50,
      token,
    });
  } catch {
    return null;
  }
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
