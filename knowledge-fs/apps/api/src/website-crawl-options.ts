import type { CrawledPage, WebsiteCrawlConnector, WebsiteCrawlResult } from "@knowledge/api";

import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";

interface CrawlEnvelope {
  readonly completed?: number | undefined;
  readonly pages: readonly CrawledPage[];
  readonly status?: string | undefined;
  readonly total?: number | undefined;
}

/**
 * Website crawl connector backed by the deployment-selected datasource runtime.
 * Accumulates the streamed `web_info_list` entries (deduped by source URL, later content wins) and
 * tracks the last-reported status/total/completed.
 */
export function createApiWebsiteCrawlConnector(input: {
  readonly client: ApiDatasourceInvocationClient;
}): WebsiteCrawlConnector {
  return {
    crawl: async ({ signal, source, tenantId, userId }): Promise<WebsiteCrawlResult> => {
      const pages = new Map<string, CrawledPage>();
      let status: string | undefined;
      let total: number | undefined;
      let completed: number | undefined;

      for await (const raw of input.client.dispatch({
        operation: "get_website_crawl",
        source,
        tenantId,
        ...(userId ? { userId } : {}),
        ...(signal ? { signal } : {}),
      })) {
        const envelope = parseCrawlEnvelope(raw);

        if (!envelope) {
          continue;
        }

        if (envelope.status !== undefined) {
          status = envelope.status;
        }

        if (envelope.total !== undefined) {
          total = envelope.total;
        }

        if (envelope.completed !== undefined) {
          completed = envelope.completed;
        }

        for (const page of envelope.pages) {
          pages.set(page.sourceUrl, page);
        }
      }

      return {
        pages: Array.from(pages.values()),
        ...(completed === undefined ? {} : { completed }),
        ...(status === undefined ? {} : { status }),
        ...(total === undefined ? {} : { total }),
      };
    },
  };
}

export function createApiWebsiteCrawlOptions(input: {
  readonly client: ApiDatasourceInvocationClient;
}): {
  readonly websiteCrawlConnector: WebsiteCrawlConnector;
} {
  return {
    websiteCrawlConnector: createApiWebsiteCrawlConnector(input),
  };
}

function parseCrawlEnvelope(raw: unknown): CrawlEnvelope | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const result = (raw as Record<string, unknown>).result;

  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const pages: CrawledPage[] = [];
  const list = record.web_info_list;

  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const info = item as Record<string, unknown>;

      if (typeof info.source_url !== "string" || !info.source_url) {
        continue;
      }

      pages.push({
        content: typeof info.content === "string" ? info.content : "",
        ...(typeof info.description === "string" ? { description: info.description } : {}),
        sourceUrl: info.source_url,
        ...(typeof info.title === "string" ? { title: info.title } : {}),
      });
    }
  }

  return {
    pages,
    ...(typeof record.completed === "number" ? { completed: record.completed } : {}),
    ...(typeof record.status === "string" ? { status: record.status } : {}),
    ...(typeof record.total === "number" ? { total: record.total } : {}),
  };
}
