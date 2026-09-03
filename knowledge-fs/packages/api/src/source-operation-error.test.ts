import { describe, expect, it } from "vitest";

import { isRegisteredKnowledgeFsErrorCode, knowledgeFsFailureForCode } from "./knowledge-fs-errors";
import { OnlineDocumentConnectorConfigError } from "./online-document-connector";
import { OnlineDriveConnectorConfigError } from "./online-drive-connector";
import {
  SourceCredentialMutationError,
  SourceCredentialUnavailableError,
} from "./source-credential-service";
import { SourceCredentialConfigError } from "./source-credential-tester";
import {
  SOURCE_OPERATION_FAILURES,
  safeSourceOperationError,
  sourceOperationFailureMetadata,
} from "./source-operation-error";
import {
  SourceSecretStoreConflictError,
  SourceSecretStoreIntegrityError,
} from "./source-secret-store";
import { WebsiteCrawlConnectorConfigError } from "./website-crawl-connector";

describe("safeSourceOperationError", () => {
  it("registers every public source-operation fallback in the common error catalog", () => {
    for (const failure of Object.values(SOURCE_OPERATION_FAILURES)) {
      expect(isRegisteredKnowledgeFsErrorCode(failure.code), failure.code).toBe(true);
    }
  });

  it("maps unknown connector failures without retaining secret-bearing messages", () => {
    const failure = safeSourceOperationError(
      "websiteCrawl",
      new Error("Authorization: Bearer credential-secret"),
    );

    expect(failure).toEqual(SOURCE_OPERATION_FAILURES.websiteCrawl);
    expect(JSON.stringify(failure)).not.toContain("credential-secret");
    expect(sourceOperationFailureMetadata(failure)).toEqual({
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
      errorCode: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
    });
  });

  it("keeps the datasource runtime code and drops its message", () => {
    const error = Object.assign(
      new Error("GET https://api.notion.com/v1/pages?token=secret failed with 401"),
      { code: "dify_datasource_runtime_request_failed", retryable: false, status: 401 },
    );

    const failure = safeSourceOperationError("onlineDocumentRequest", error);

    expect(failure).toEqual({
      code: "dify_datasource_runtime_request_failed",
      message: SOURCE_OPERATION_FAILURES.onlineDocumentRequest.message,
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
    // The persisted code resolves to the specific provider failure when it is read back.
    expect(knowledgeFsFailureForCode(failure.code)).toMatchObject({
      code: "SOURCE_PROVIDER_UNAVAILABLE",
      retryPolicy: "manual",
    });
  });

  it("allows a typed local configuration error with a stable code", () => {
    const error = new WebsiteCrawlConnectorConfigError(
      "Website crawl source source-1 metadata.provider is required",
    );

    expect(safeSourceOperationError("websiteCrawl", error)).toEqual({
      code: "SOURCE_WEBSITE_CRAWL_CONFIG_INVALID",
      message: error.message,
    });
  });

  it.each([
    [new SourceCredentialUnavailableError(), "SOURCE_CREDENTIAL_UNAVAILABLE"],
    [
      new SourceCredentialMutationError("Credential rotation failed"),
      "SOURCE_CREDENTIAL_MUTATION_FAILED",
    ],
    [new SourceSecretStoreConflictError(), "SOURCE_SECRET_REF_CONFLICT"],
    [new SourceSecretStoreIntegrityError(), "SOURCE_SECRET_INTEGRITY_FAILED"],
    [
      new SourceCredentialConfigError("Credential config is invalid"),
      "SOURCE_CREDENTIAL_CONFIG_INVALID",
    ],
    [
      new OnlineDocumentConnectorConfigError("Online-document config is invalid"),
      "SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID",
    ],
    [
      new OnlineDriveConnectorConfigError("Online-drive config is invalid"),
      "SOURCE_ONLINE_DRIVE_CONFIG_INVALID",
    ],
  ])("preserves allowlisted typed failures", (error, code) => {
    expect(safeSourceOperationError("credentialTest", error)).toEqual({
      code,
      message: error.message,
    });
  });
});
