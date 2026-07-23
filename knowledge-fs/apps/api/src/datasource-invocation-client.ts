import type { Source } from "@knowledge/core";

interface DatasourceInvocationBase {
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export type ApiDatasourceInvocationInput =
  | (DatasourceInvocationBase & {
      readonly operation: "get_website_crawl";
    })
  | (DatasourceInvocationBase & {
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
      readonly operation: "get_online_document_pages";
    })
  | (DatasourceInvocationBase & {
      readonly operation: "get_online_document_page_content";
      readonly page: {
        readonly pageId: string;
        readonly type: string;
        readonly workspaceId: string;
      };
    })
  | (DatasourceInvocationBase & {
      readonly bucket?: string | undefined;
      readonly continuationToken?: string | undefined;
      readonly maxKeys?: number | undefined;
      readonly operation: "online_drive_browse_files";
      readonly prefix?: string | undefined;
    })
  | (DatasourceInvocationBase & {
      readonly file: {
        readonly bucket?: string | undefined;
        readonly id: string;
      };
      readonly operation: "online_drive_download_file";
    })
  | (DatasourceInvocationBase & {
      readonly operation: "validate_credentials";
    });

/** Dify-backed deployment adapter shared by datasource connectors. */
export interface ApiDatasourceInvocationClient {
  dispatch(input: ApiDatasourceInvocationInput): AsyncGenerator<unknown>;
}
