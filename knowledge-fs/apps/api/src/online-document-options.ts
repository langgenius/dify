import {
  type OnlineDocumentConnector,
  type OnlineDocumentListResult,
  type OnlineDocumentPage,
  type OnlineDocumentPageContent,
  readOnlineDocumentSourceConfig,
} from "@knowledge/api";
import type { PluginDaemonClient } from "@knowledge/plugin-daemon-client";

import { type PluginDaemonClientEnv, createApiPluginDaemonClient } from "./plugin-daemon-options";

interface WorkspaceAccumulator {
  readonly pages: Map<string, OnlineDocumentPage>;
  total?: number | undefined;
  workspaceId?: string | undefined;
  workspaceName?: string | undefined;
}

interface ListingEnvelopeMetadata {
  nextCursor?: string | undefined;
}

/**
 * Online-document connector backed by the plugin-daemon `get_online_document_pages` and
 * `get_online_document_page_content` datasource methods (Notion, …). Page listing accumulates the
 * streamed workspaces/pages (deduped); page content takes the last non-empty content chunk.
 */
export function createApiOnlineDocumentConnector(input: {
  readonly client: PluginDaemonClient;
}): OnlineDocumentConnector {
  return {
    getPageContent: async ({ page, signal, source, tenantId, userId }) => {
      const config = readOnlineDocumentSourceConfig(source);
      let content = "";
      let pageId = page.pageId;
      let workspaceId: string | undefined;

      for await (const raw of input.client.dispatchDatasourceStream({
        data: {
          credentials: config.credentials,
          datasource: config.datasource,
          page: { page_id: page.pageId, type: page.type, workspace_id: page.workspaceId },
          provider: config.provider,
        },
        method: "get_online_document_page_content",
        pluginId: config.pluginId,
        tenantId,
        ...(userId ? { userId } : {}),
        ...(signal ? { signal } : {}),
      })) {
        const parsed = parseContentEnvelope(raw);

        if (!parsed) {
          continue;
        }

        if (parsed.content) {
          content = parsed.content;
        }

        if (parsed.pageId) {
          pageId = parsed.pageId;
        }

        if (parsed.workspaceId) {
          workspaceId = parsed.workspaceId;
        }
      }

      const result: OnlineDocumentPageContent = {
        content,
        pageId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      };

      return result;
    },
    listPages: async ({
      cursor,
      limit,
      signal,
      source,
      tenantId,
      userId,
    }): Promise<OnlineDocumentListResult> => {
      const config = readOnlineDocumentSourceConfig(source);
      const workspaces = new Map<string, WorkspaceAccumulator>();
      const metadata: ListingEnvelopeMetadata = {};

      for await (const raw of input.client.dispatchDatasourceStream({
        data: {
          credentials: config.credentials,
          datasource: config.datasource,
          datasource_parameters: {
            ...config.parameters,
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
          },
          provider: config.provider,
        },
        method: "get_online_document_pages",
        pluginId: config.pluginId,
        tenantId,
        ...(userId ? { userId } : {}),
        ...(signal ? { signal } : {}),
      })) {
        accumulateWorkspaces(workspaces, metadata, raw);
      }

      return {
        ...(metadata.nextCursor === undefined ? {} : { nextCursor: metadata.nextCursor }),
        workspaces: Array.from(workspaces.values()).map((workspace) => ({
          pages: Array.from(workspace.pages.values()),
          ...(workspace.total === undefined ? {} : { total: workspace.total }),
          ...(workspace.workspaceId === undefined ? {} : { workspaceId: workspace.workspaceId }),
          ...(workspace.workspaceName === undefined
            ? {}
            : { workspaceName: workspace.workspaceName }),
        })),
      };
    },
  };
}

export function createApiOnlineDocumentOptions(env: PluginDaemonClientEnv = process.env): {
  readonly onlineDocumentConnector: OnlineDocumentConnector;
} {
  return {
    onlineDocumentConnector: createApiOnlineDocumentConnector({
      client: createApiPluginDaemonClient(env),
    }),
  };
}

function accumulateWorkspaces(
  workspaces: Map<string, WorkspaceAccumulator>,
  metadata: ListingEnvelopeMetadata,
  raw: unknown,
): void {
  if (!raw || typeof raw !== "object") {
    return;
  }

  const result = (raw as Record<string, unknown>).result;

  const envelopeCursor = (raw as Record<string, unknown>).next_cursor;
  if (typeof envelopeCursor === "string" && envelopeCursor) {
    metadata.nextCursor = envelopeCursor;
  }

  if (!Array.isArray(result)) {
    if (result && typeof result === "object") {
      const cursor = (result as Record<string, unknown>).next_cursor;
      if (typeof cursor === "string" && cursor) metadata.nextCursor = cursor;
    }
    return;
  }

  for (const item of result) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const info = item as Record<string, unknown>;
    if (typeof info.next_cursor === "string" && info.next_cursor) {
      metadata.nextCursor = info.next_cursor;
    }
    const workspaceId = typeof info.workspace_id === "string" ? info.workspace_id : undefined;
    const key = workspaceId ?? "";
    const accumulator = workspaces.get(key) ?? { pages: new Map<string, OnlineDocumentPage>() };

    if (workspaceId !== undefined) {
      accumulator.workspaceId = workspaceId;
    }

    if (typeof info.workspace_name === "string") {
      accumulator.workspaceName = info.workspace_name;
    }

    if (typeof info.total === "number") {
      accumulator.total = info.total;
    }

    if (Array.isArray(info.pages)) {
      for (const rawPage of info.pages) {
        const page = parsePage(rawPage);

        if (page) {
          accumulator.pages.set(page.pageId, page);
        }
      }
    }

    workspaces.set(key, accumulator);
  }
}

function parsePage(raw: unknown): OnlineDocumentPage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.page_id !== "string" || typeof record.type !== "string") {
    return undefined;
  }

  return {
    ...(typeof record.last_edited_time === "string"
      ? { lastEditedTime: record.last_edited_time }
      : {}),
    pageId: record.page_id,
    pageName: typeof record.page_name === "string" ? record.page_name : record.page_id,
    ...(typeof record.parent_id === "string" ? { parentId: record.parent_id } : {}),
    type: record.type,
  };
}

function parseContentEnvelope(
  raw: unknown,
): { content: string; pageId?: string; workspaceId?: string } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const result = (raw as Record<string, unknown>).result;

  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;

  return {
    content: typeof record.content === "string" ? record.content : "",
    ...(typeof record.page_id === "string" ? { pageId: record.page_id } : {}),
    ...(typeof record.workspace_id === "string" ? { workspaceId: record.workspace_id } : {}),
  };
}
