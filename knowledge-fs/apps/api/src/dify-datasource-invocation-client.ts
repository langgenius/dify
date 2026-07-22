import type { Source } from "@knowledge/core";
import type {
  DifyDatasourceRuntimeClient,
  DifyDatasourceType,
} from "@knowledge/dify-datasource-runtime-client";

import type {
  ApiDatasourceInvocationClient,
  ApiDatasourceInvocationInput,
} from "./datasource-invocation-client";

interface DifyDatasourceSourceConfig {
  readonly credentialId: string;
  readonly datasource: string;
  readonly parameters: Record<string, unknown>;
  readonly pluginId: string;
  readonly provider: string;
}

/** Builds the integrated adapter and fails closed if a Source carries credential material. */
export function createDifyDatasourceInvocationClient(input: {
  readonly client: DifyDatasourceRuntimeClient;
}): ApiDatasourceInvocationClient {
  return {
    async *dispatch(invocation) {
      const config = readDifyDatasourceSourceConfig(invocation.source);
      const common = {
        credentialId: config.credentialId,
        datasource: config.datasource,
        pluginId: config.pluginId,
        provider: config.provider,
        tenantId: invocation.tenantId,
        ...(invocation.userId ? { userId: invocation.userId } : {}),
        ...(invocation.signal ? { signal: invocation.signal } : {}),
      };

      switch (invocation.operation) {
        case "get_website_crawl":
          yield* input.client.getWebsiteCrawl({
            ...common,
            datasourceParameters: withCrawlUrl(config.parameters, invocation.source.uri),
          });
          return;
        case "get_online_document_pages":
          yield* input.client.getOnlineDocumentPages({
            ...common,
            datasourceParameters: {
              ...config.parameters,
              ...(invocation.cursor === undefined ? {} : { cursor: invocation.cursor }),
              ...(invocation.limit === undefined ? {} : { limit: invocation.limit }),
            },
          });
          return;
        case "get_online_document_page_content":
          yield* input.client.getOnlineDocumentPageContent({
            ...common,
            page: invocation.page,
          });
          return;
        case "online_drive_browse_files":
          yield* input.client.browseOnlineDrive({
            ...common,
            ...(invocation.bucket === undefined ? {} : { bucket: invocation.bucket }),
            ...(invocation.continuationToken === undefined
              ? {}
              : { nextPageParameters: decodeNextPageParameters(invocation.continuationToken) }),
            ...(invocation.maxKeys === undefined ? {} : { maxKeys: invocation.maxKeys }),
            prefix: invocation.prefix ?? "",
          });
          return;
        case "online_drive_download_file":
          yield* input.client.downloadOnlineDriveFile({ ...common, file: invocation.file });
          return;
        case "validate_credentials":
          yield {
            result: await input.client.validateCredentials({
              ...common,
              datasourceType: datasourceTypeForSource(invocation.source),
            }),
          };
      }
    },
  };
}

function readDifyDatasourceSourceConfig(source: Source): DifyDatasourceSourceConfig {
  const metadata = source.metadata;
  if (containsInlineCredentialMaterial(metadata)) {
    throw new Error("Inline datasource credentials are forbidden in integrated mode");
  }

  return {
    credentialId: requiredString(metadata, "credentialId", source.id),
    datasource: requiredString(metadata, "datasource", source.id),
    parameters: plainObject(metadata.parameters),
    pluginId: requiredString(metadata, "pluginId", source.id),
    provider: requiredString(metadata, "provider", source.id),
  };
}

function containsInlineCredentialMaterial(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsInlineCredentialMaterial(item, seen));
  }
  return Object.entries(value as Readonly<Record<string, unknown>>).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (
      normalized !== "credentialid" &&
      (normalized === "authorization" ||
        normalized === "accesskeyid" ||
        normalized === "clientid" ||
        normalized === "cookie" ||
        normalized === "credentialref" ||
        normalized === "proxyauthorization" ||
        normalized === "secretaccesskey" ||
        normalized === "setcookie" ||
        /(?:credentials?|apikey|token|secret|clientsecret|password|privatekey|signingkey)$/u.test(
          normalized,
        ))
    ) {
      return true;
    }
    return containsInlineCredentialMaterial(child, seen);
  });
}

function datasourceTypeForSource(source: Source): DifyDatasourceType {
  if (source.type === "web") return "website_crawl";
  const providerKind = source.metadata.providerKind;
  if (providerKind === "online-document") return "online_document";
  if (providerKind === "online-drive") return "online_drive";
  throw new Error(`Datasource source ${source.id} metadata.providerKind is required`);
}

function withCrawlUrl(parameters: Record<string, unknown>, uri: string): Record<string, unknown> {
  return typeof parameters.url === "string" && parameters.url.trim()
    ? parameters
    : { ...parameters, url: uri };
}

function decodeNextPageParameters(token: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }
  } catch {
    // The public token is opaque. Any malformed value fails before reaching Dify.
  }
  throw new Error("Online-drive continuation token is invalid");
}

function requiredString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  sourceId: string,
): string {
  const value = metadata[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Datasource source ${sourceId} metadata.${key} is required`);
  }
  return value.trim();
}

function plainObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
