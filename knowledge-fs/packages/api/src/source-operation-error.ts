import { OnlineDocumentConnectorConfigError } from "./online-document-connector";
import { OnlineDriveConnectorConfigError } from "./online-drive-connector";
import {
  SourceCredentialMutationError,
  SourceCredentialUnavailableError,
} from "./source-credential-service";
import { SourceCredentialConfigError } from "./source-credential-tester";
import {
  SourceSecretStoreConflictError,
  SourceSecretStoreIntegrityError,
} from "./source-secret-store";
import { WebsiteCrawlConnectorConfigError } from "./website-crawl-connector";

export interface SafeSourceOperationError {
  readonly code: string;
  readonly message: string;
}

/**
 * Public and persisted source-operation failures. Connector/plugin exceptions are deliberately
 * reduced to these constants because an upstream message can echo credentials, request headers,
 * or signed URLs.
 */
export const SOURCE_OPERATION_FAILURES = {
  credentialTest: {
    code: "SOURCE_CREDENTIAL_TEST_FAILED",
    message: "Source credential test failed",
  },
  documentMaterialization: {
    code: "SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
    message: "Source document materialization failed",
  },
  onlineDocumentImport: {
    code: "SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED",
    message: "Online-document import failed",
  },
  onlineDocumentPageFetch: {
    code: "SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED",
    message: "Online-document page fetch failed",
  },
  onlineDocumentRequest: {
    code: "SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED",
    message: "Online-document request failed",
  },
  onlineDriveFileDownload: {
    code: "SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED",
    message: "Online-drive file download failed",
  },
  onlineDriveImport: {
    code: "SOURCE_ONLINE_DRIVE_IMPORT_FAILED",
    message: "Online-drive import failed",
  },
  onlineDriveRequest: {
    code: "SOURCE_ONLINE_DRIVE_REQUEST_FAILED",
    message: "Online-drive request failed",
  },
  sourceBulk: {
    code: "SOURCE_BULK_ACTION_FAILED",
    message: "Source bulk action failed",
  },
  sourceWorkflow: {
    code: "SOURCE_WORKFLOW_FAILED",
    message: "Source workflow failed",
  },
  sync: {
    code: "SOURCE_SYNC_FAILED",
    message: "Source sync failed",
  },
  websiteCrawl: {
    code: "SOURCE_WEBSITE_CRAWL_FAILED",
    message: "Website crawl failed",
  },
} as const satisfies Record<string, SafeSourceOperationError>;

export type SourceOperationFailureKind = keyof typeof SOURCE_OPERATION_FAILURES;

const CONFIG_FAILURES = {
  credential: { code: "SOURCE_CREDENTIAL_CONFIG_INVALID" },
  onlineDocument: { code: "SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID" },
  onlineDrive: { code: "SOURCE_ONLINE_DRIVE_CONFIG_INVALID" },
  websiteCrawl: { code: "SOURCE_WEBSITE_CRAWL_CONFIG_INVALID" },
} as const;

/** Maps an exception to an allowlisted business error or an operation-specific generic failure. */
export function safeSourceOperationError(
  kind: SourceOperationFailureKind,
  error: unknown,
): SafeSourceOperationError {
  if (error instanceof SourceCredentialUnavailableError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof SourceCredentialMutationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof SourceSecretStoreConflictError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof SourceSecretStoreIntegrityError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof SourceCredentialConfigError) {
    return { code: CONFIG_FAILURES.credential.code, message: error.message };
  }
  if (error instanceof OnlineDocumentConnectorConfigError) {
    return { code: CONFIG_FAILURES.onlineDocument.code, message: error.message };
  }
  if (error instanceof OnlineDriveConnectorConfigError) {
    return { code: CONFIG_FAILURES.onlineDrive.code, message: error.message };
  }
  if (error instanceof WebsiteCrawlConnectorConfigError) {
    return { code: CONFIG_FAILURES.websiteCrawl.code, message: error.message };
  }

  return SOURCE_OPERATION_FAILURES[kind];
}

export function sourceOperationFailureMetadata(
  failure: SafeSourceOperationError,
): Readonly<{ error: string; errorCode: string }> {
  return { error: failure.message, errorCode: failure.code };
}
