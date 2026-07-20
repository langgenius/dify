import type { Source } from "@knowledge/core";

/** A page listed from an online-document provider (Notion-like), normalized from the plugin-daemon. */
export interface OnlineDocumentPage {
  readonly lastEditedTime?: string | undefined;
  readonly pageId: string;
  readonly pageName: string;
  readonly parentId?: string | undefined;
  readonly type: string;
}

export interface OnlineDocumentWorkspace {
  readonly pages: readonly OnlineDocumentPage[];
  readonly total?: number | undefined;
  readonly workspaceId?: string | undefined;
  readonly workspaceName?: string | undefined;
}

export interface OnlineDocumentListResult {
  /** Opaque provider cursor. Callers must return it unchanged to continue the listing. */
  readonly nextCursor?: string | undefined;
  readonly workspaces: readonly OnlineDocumentWorkspace[];
}

/** Identifies one page to fetch content for. */
export interface OnlineDocumentPageRef {
  readonly pageId: string;
  readonly type: string;
  readonly workspaceId: string;
}

export interface OnlineDocumentPageContent {
  readonly content: string;
  readonly pageId: string;
  readonly workspaceId?: string | undefined;
}

export interface OnlineDocumentListInput {
  readonly cursor?: string | undefined;
  /** Bounded by the HTTP/product service before invoking a provider. */
  readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export interface OnlineDocumentContentInput {
  readonly page: OnlineDocumentPageRef;
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

/**
 * Connector for online-document providers (Notion, …). The concrete implementation dispatches the
 * plugin-daemon `get_online_document_pages` / `get_online_document_page_content` datasource methods
 * (see apps/api); it is injected as a gateway option so `@knowledge/api` stays free of the
 * plugin-daemon transport dependency.
 */
export interface OnlineDocumentConnector {
  getPageContent(input: OnlineDocumentContentInput): Promise<OnlineDocumentPageContent>;
  listPages(input: OnlineDocumentListInput): Promise<OnlineDocumentListResult>;
}

export class OnlineDocumentConnectorConfigError extends Error {}

export interface OnlineDocumentSourceConfig {
  readonly credentials: Record<string, unknown>;
  readonly datasource: string;
  readonly parameters: Record<string, unknown>;
  readonly pluginId: string;
  readonly provider: string;
}

export function readOnlineDocumentSourceConfig(source: Source): OnlineDocumentSourceConfig {
  if (source.type !== "connector") {
    throw new OnlineDocumentConnectorConfigError(
      `Source ${source.id} is not an online-document connector`,
    );
  }

  const metadata = source.metadata;

  return {
    credentials: plainObject(metadata.credentials),
    datasource: requiredString(metadata, "datasource", source.id),
    parameters: plainObject(metadata.parameters),
    pluginId: requiredString(metadata, "pluginId", source.id),
    provider: requiredString(metadata, "provider", source.id),
  };
}

function requiredString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  sourceId: string,
): string {
  const value = metadata[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new OnlineDocumentConnectorConfigError(
      `Online-document source ${sourceId} metadata.${key} is required`,
    );
  }

  return value.trim();
}

function plainObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
