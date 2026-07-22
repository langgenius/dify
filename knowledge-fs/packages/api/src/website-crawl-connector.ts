import type { Source } from "@knowledge/core";

/** A single crawled web page, normalized from the selected datasource runtime. */
export interface CrawledPage {
  readonly content: string;
  readonly description?: string | undefined;
  readonly sourceUrl: string;
  readonly title?: string | undefined;
}

export interface WebsiteCrawlResult {
  readonly completed?: number | undefined;
  readonly pages: readonly CrawledPage[];
  readonly status?: string | undefined;
  readonly total?: number | undefined;
}

export interface WebsiteCrawlInput {
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

/**
 * Runs a website crawl for a web `Source`. The concrete implementation dispatches the
 * `get_website_crawl` datasource method through a deployment-owned adapter. It is injected as a
 * gateway option so `@knowledge/api` stays free of transport and credential ownership concerns.
 */
export interface WebsiteCrawlConnector {
  crawl(input: WebsiteCrawlInput): Promise<WebsiteCrawlResult>;
}

export class WebsiteCrawlConnectorConfigError extends Error {}

/** Reads and validates the daemon datasource config a web `Source` must carry in its metadata. */
export interface WebsiteCrawlSourceConfig {
  readonly credentials: Record<string, unknown>;
  readonly datasource: string;
  readonly parameters: Record<string, unknown>;
  readonly pluginId: string;
  readonly provider: string;
}

export function readWebsiteCrawlSourceConfig(source: Source): WebsiteCrawlSourceConfig {
  if (source.type !== "web") {
    throw new WebsiteCrawlConnectorConfigError(`Source ${source.id} is not a website crawl source`);
  }

  const metadata = source.metadata;
  const pluginId = requiredString(metadata, "pluginId", source.id);
  const provider = requiredString(metadata, "provider", source.id);
  const datasource = requiredString(metadata, "datasource", source.id);

  return {
    credentials: plainObject(metadata.credentials),
    datasource,
    parameters: withCrawlUrl(plainObject(metadata.parameters), source.uri),
    pluginId,
    provider,
  };
}

/** Ensures the crawl root URL from `Source.uri` is present in the datasource parameters. */
function withCrawlUrl(parameters: Record<string, unknown>, uri: string): Record<string, unknown> {
  if (typeof parameters.url === "string" && parameters.url.trim()) {
    return parameters;
  }

  return { ...parameters, url: uri };
}

function requiredString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  sourceId: string,
): string {
  const value = metadata[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new WebsiteCrawlConnectorConfigError(
      `Website crawl source ${sourceId} metadata.${key} is required`,
    );
  }

  return value.trim();
}

function plainObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
