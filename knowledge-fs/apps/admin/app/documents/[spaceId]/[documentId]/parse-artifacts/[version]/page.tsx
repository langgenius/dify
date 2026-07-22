import React from "react";

import {
  type AdminParseArtifact,
  createAdminApiClient,
  getAdminApiBase,
} from "../../../../../../lib/api-client";
import { adminRowKey } from "../../../../../../lib/graph-row-keys";
import { getAdminServerToken } from "../../../../../../lib/server-auth";

interface ParseArtifactPageProps {
  readonly params: Promise<{
    readonly documentId: string;
    readonly spaceId: string;
    readonly version: string;
  }>;
}

export const dynamic = "force-dynamic";

export default async function ParseArtifactPage({ params }: ParseArtifactPageProps) {
  const { documentId, spaceId, version } = await params;
  const artifact = await loadParseArtifact({ documentId, spaceId, version });

  return (
    <main className="admin-shell single-panel-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Parse artifact</h1>
            <p>Versioned parser output for the selected document.</p>
          </div>
          <a className="button secondary" href={`/documents/${spaceId}/${documentId}`}>
            Back to document
          </a>
        </header>
        <article className="panel">
          {artifact ? (
            <ParseArtifactCard artifact={artifact} />
          ) : (
            <UnavailableArtifact documentId={documentId} version={version} />
          )}
        </article>
      </section>
    </main>
  );
}

function ParseArtifactCard({ artifact }: { readonly artifact: AdminParseArtifact }) {
  return (
    <>
      <div className="panel-header">
        <div>
          <h2>{artifact.parser}</h2>
          <small className="mono">{artifact.id}</small>
        </div>
        <span className="badge ok">v{artifact.version}</span>
      </div>
      <div className="status-list">
        <div className="status-row">
          <strong>Document asset</strong>
          <span className="mono">{artifact.documentAssetId}</span>
        </div>
        <div className="status-row">
          <strong>Artifact hash</strong>
          <span className="mono">{artifact.artifactHash.slice(0, 12)}</span>
        </div>
        <div className="status-row">
          <strong>Elements</strong>
          <span>{artifact.elements.length}</span>
        </div>
      </div>
      <div className="table" aria-label="Parse elements">
        <div className="table-row">
          <strong>Element</strong>
          <span>Text</span>
        </div>
        {artifact.elements.map((element, index) => (
          <div className="table-row" key={adminRowKey("parse-element", element.id, index)}>
            <div>
              <strong>{element.type}</strong>
              <div className="mono">{element.sectionPath.join(" / ") || "root"}</div>
            </div>
            <span>{element.text ?? ""}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function UnavailableArtifact({
  documentId,
  version,
}: {
  readonly documentId: string;
  readonly version: string;
}) {
  return (
    <div className="result-card fail">
      <div className="panel-header">
        <div>
          <h2>Parse artifact unavailable</h2>
          <small className="mono">
            {documentId} v{version}
          </small>
        </div>
        <span className="badge fail">not found</span>
      </div>
    </div>
  );
}

async function loadParseArtifact({
  documentId,
  spaceId,
  version,
}: {
  readonly documentId: string;
  readonly spaceId: string;
  readonly version: string;
}): Promise<AdminParseArtifact | null> {
  const parsedVersion = Number(version);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return null;
  }

  const token = getAdminServerToken();
  if (!token) {
    return null;
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    return await client.getParseArtifact({
      documentId,
      knowledgeSpaceId: spaceId,
      token,
      version: parsedVersion,
    });
  } catch {
    return null;
  }
}
