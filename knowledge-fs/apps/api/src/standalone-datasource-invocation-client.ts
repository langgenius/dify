import {
  readOnlineDocumentSourceConfig,
  readOnlineDriveSourceConfig,
  readSourceCredentialConfig,
  readWebsiteCrawlSourceConfig,
} from "@knowledge/api";
import type { PluginDaemonDatasourceClient } from "@knowledge/plugin-daemon-client";

import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";

/** Legacy standalone adapter. It is the only application adapter allowed to receive source secrets. */
export function createStandaloneDatasourceInvocationClient(input: {
  readonly client: PluginDaemonDatasourceClient;
}): ApiDatasourceInvocationClient {
  return {
    dispatch(invocation) {
      switch (invocation.operation) {
        case "get_website_crawl": {
          const config = readWebsiteCrawlSourceConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: {
              credentials: config.credentials,
              datasource: config.datasource,
              datasource_parameters: config.parameters,
              provider: config.provider,
            },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
        case "get_online_document_pages": {
          const config = readOnlineDocumentSourceConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: {
              credentials: config.credentials,
              datasource: config.datasource,
              datasource_parameters: {
                ...config.parameters,
                ...(invocation.cursor === undefined ? {} : { cursor: invocation.cursor }),
                ...(invocation.limit === undefined ? {} : { limit: invocation.limit }),
              },
              provider: config.provider,
            },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
        case "get_online_document_page_content": {
          const config = readOnlineDocumentSourceConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: {
              credentials: config.credentials,
              datasource: config.datasource,
              page: {
                page_id: invocation.page.pageId,
                type: invocation.page.type,
                workspace_id: invocation.page.workspaceId,
              },
              provider: config.provider,
            },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
        case "online_drive_browse_files": {
          const config = readOnlineDriveSourceConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: {
              credentials: config.credentials,
              datasource: config.datasource,
              provider: config.provider,
              request: {
                ...(invocation.bucket === undefined ? {} : { bucket: invocation.bucket }),
                ...(invocation.continuationToken === undefined
                  ? {}
                  : { continuation_token: invocation.continuationToken }),
                max_keys: invocation.maxKeys ?? 20,
                prefix: invocation.prefix ?? "",
              },
            },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
        case "online_drive_download_file": {
          const config = readOnlineDriveSourceConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: {
              credentials: config.credentials,
              datasource: config.datasource,
              provider: config.provider,
              request: { bucket: invocation.file.bucket ?? "", id: invocation.file.id },
            },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
        case "validate_credentials": {
          const config = readSourceCredentialConfig(invocation.source);
          return input.client.dispatchDatasourceStream({
            data: { credentials: config.credentials, provider: config.provider },
            method: invocation.operation,
            pluginId: config.pluginId,
            tenantId: invocation.tenantId,
            ...(invocation.userId ? { userId: invocation.userId } : {}),
            ...(invocation.signal ? { signal: invocation.signal } : {}),
          });
        }
      }
    },
  };
}
