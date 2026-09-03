import { describe, expect, it } from "vitest";

import {
  KnowledgeFsError,
  KnowledgeFsNotFoundError,
  KnowledgeFsValidationError,
  knowledgeFsFailureAllowsManualRetry,
  knowledgeFsFailureForCode,
  knowledgeFsFailureFromError,
} from "./knowledge-fs-errors";

describe("KnowledgeFS public errors", () => {
  it("maps actionable model failures without exposing the internal exception message", () => {
    const failure = knowledgeFsFailureFromError(
      Object.assign(new Error("provider echoed Authorization: secret"), {
        code: "MODEL_SELECTION_NOT_FOUND",
      }),
      { stage: "model_preflight", traceId: "trace-model" },
    );

    expect(failure).toEqual({
      action: "configure_model",
      category: "configuration",
      code: "MODEL_SELECTION_NOT_FOUND",
      message:
        "The selected model is no longer available in this workspace. Select another model before retrying.",
      retryPolicy: "after_configuration",
      stage: "model_preflight",
      traceId: "trace-model",
    });
    expect(JSON.stringify(failure)).not.toContain("Authorization");
    expect(knowledgeFsFailureAllowsManualRetry(failure)).toBe(false);
  });

  it("normalizes provider codes and permits a terminal retry for transient failures", () => {
    const failure = knowledgeFsFailureForCode("dify_model_runtime_timeout");

    expect(failure).toMatchObject({
      action: "retry",
      category: "timeout",
      code: "MODEL_RUNTIME_TIMEOUT",
      retryPolicy: "automatic",
    });
    expect(knowledgeFsFailureAllowsManualRetry(failure)).toBe(true);
  });

  it("keeps retrieval deletion admission distinct from an unrelated conflict", () => {
    const failure = knowledgeFsFailureForCode("RETRIEVAL_DELETION_IN_PROGRESS");

    expect(failure).toEqual({
      category: "conflict",
      code: "RETRIEVAL_DELETION_IN_PROGRESS",
      message: "This knowledge space is being deleted and cannot be searched.",
      retryPolicy: "never",
    });
    expect(knowledgeFsFailureAllowsManualRetry(failure)).toBe(false);
  });

  it("keeps an execution lease loss actionable without exposing runtime diagnostics", () => {
    const failure = knowledgeFsFailureForCode("RETRIEVAL_EXECUTION_LEASE_LOST");

    expect(failure).toEqual({
      action: "retry",
      category: "conflict",
      code: "RETRIEVAL_EXECUTION_LEASE_LOST",
      message: "The retrieval execution expired before it could finish. Run the query again.",
      retryPolicy: "manual",
    });
  });

  it("maps parser deadlines to a manual timeout instead of an automatic retry", () => {
    const failure = knowledgeFsFailureForCode("provider_timeout");

    expect(failure).toMatchObject({
      action: "retry",
      category: "timeout",
      code: "DOCUMENT_PARSER_TIMEOUT",
      retryPolicy: "manual",
    });
    expect(knowledgeFsFailureAllowsManualRetry(failure)).toBe(true);
  });

  it("uses safe family fallbacks and bounds public parameters", () => {
    expect(knowledgeFsFailureForCode("SOURCE_DOCUMENT_COMPILATION_FAILED")).toMatchObject({
      action: "retry",
      category: "dependency",
      code: "SOURCE_DOCUMENT_COMPILATION_FAILED",
      retryPolicy: "manual",
    });
    expect(
      knowledgeFsFailureForCode("SOURCE_SYNC_CURSOR_LOOP", {
        parameters: {
          attempt: 3,
          bad$key: "ignored",
          providerKind: "notion",
          secret: "x".repeat(400),
        },
        stage: "Authorization: Bearer secret",
      }),
    ).toMatchObject({
      action: "retry",
      category: "dependency",
      code: "SOURCE_OPERATION_FAILED",
      parameters: {
        attempt: 3,
        providerKind: "notion",
      },
    });
    expect(
      knowledgeFsFailureForCode("SOURCE_SYNC_FAILED", {
        stage: "source_sync.retry-1",
      }),
    ).toMatchObject({ stage: "source_sync.retry-1" });
    expect(knowledgeFsFailureForCode("SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED")).toMatchObject({
      action: "contact_admin",
      category: "dependency",
      code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED",
      retryPolicy: "never",
    });
    expect(knowledgeFsFailureForCode("SOURCE_SYNC_SELECTION_MISMATCH")).toMatchObject({
      action: "contact_admin",
      category: "conflict",
      code: "SOURCE_SYNC_SELECTION_MISMATCH",
      retryPolicy: "never",
    });
  });

  it("keeps model, embedding, and datasource runtime failures specific", () => {
    expect(knowledgeFsFailureForCode("dify_model_runtime_response_invalid")).toMatchObject({
      action: "retry",
      category: "dependency",
      code: "MODEL_RUNTIME_RESPONSE_INVALID",
      retryPolicy: "manual",
    });
    expect(knowledgeFsFailureForCode("embedding_provider_input")).toMatchObject({
      code: "MODEL_RUNTIME_FAILED",
    });
    expect(knowledgeFsFailureForCode("embedding_provider_response_invalid")).toMatchObject({
      code: "MODEL_RUNTIME_RESPONSE_INVALID",
    });
    expect(knowledgeFsFailureForCode("dify_datasource_runtime_timeout")).toMatchObject({
      category: "timeout",
      code: "SOURCE_PROVIDER_TIMEOUT",
      retryPolicy: "manual",
    });
    expect(knowledgeFsFailureForCode("dify_datasource_runtime_request_failed")).toMatchObject({
      code: "SOURCE_PROVIDER_UNAVAILABLE",
    });
    expect(knowledgeFsFailureForCode("dify_datasource_runtime_response_invalid")).toMatchObject({
      action: "configure_source",
      code: "SOURCE_PROVIDER_REJECTED",
    });
    expect(knowledgeFsFailureForCode("document_parser_unsupported_type")).toMatchObject({
      action: "reupload",
      category: "validation",
      code: "DOCUMENT_PARSER_UNSUPPORTED_TYPE",
      retryPolicy: "never",
    });
    // Source workflow diagnostics that used to collapse into the generic operation failure.
    expect(knowledgeFsFailureForCode("SOURCE_CRAWL_PAGE_NOT_FOUND")).toMatchObject({
      action: "configure_source",
      category: "not_found",
      code: "SOURCE_CRAWL_PAGE_NOT_FOUND",
    });
    expect(knowledgeFsFailureForCode("SOURCE_WORKFLOW_CONTENT_TOO_LARGE")).toMatchObject({
      category: "validation",
      code: "SOURCE_WORKFLOW_CONTENT_TOO_LARGE",
      retryPolicy: "never",
    });
    expect(knowledgeFsFailureForCode("SOURCE_WORKFLOW_EXTERNAL_TIMEOUT")).toMatchObject({
      category: "timeout",
      code: "SOURCE_WORKFLOW_EXTERNAL_TIMEOUT",
    });
  });

  it("never exposes an unregistered diagnostic code in the structured contract", () => {
    expect(knowledgeFsFailureForCode("database_password_leaked")).toMatchObject({
      category: "internal",
      code: "KNOWLEDGE_FS_INTERNAL_ERROR",
    });
    expect(knowledgeFsFailureForCode("PARSER_FAILED")).toMatchObject({
      category: "dependency",
      code: "DOCUMENT_PARSER_UNAVAILABLE",
    });
  });

  it("masks unknown errors and retains only a bounded support reference", () => {
    const failure = knowledgeFsFailureFromError(new Error("database password=secret"), {
      traceId: "Authorization: Bearer trace-secret",
    });

    expect(failure.code).toBe("KNOWLEDGE_FS_INTERNAL_ERROR");
    expect(failure).not.toHaveProperty("traceId");
    expect(failure.message).not.toContain("password");
    expect(
      knowledgeFsFailureFromError(new Error("diagnostic"), { traceId: "trace-safe_1:span.2" }),
    ).toMatchObject({ traceId: "trace-safe_1:span.2" });
  });

  it("keeps compatible validation and not-found specializations", () => {
    const validation = new KnowledgeFsValidationError("database column cursor_secret is invalid");
    const missing = new KnowledgeFsNotFoundError("private object key was not found");
    const safeMissing = new KnowledgeFsNotFoundError("diagnostic", {
      publicMessage: "The selected document was not found.",
    });
    const typed = new KnowledgeFsError("diagnostic", {
      code: "KNOWLEDGE_FS_UNAVAILABLE",
      publicMessage: "A safe dependency message",
    });

    expect(knowledgeFsFailureFromError(validation)).toMatchObject({
      code: "KNOWLEDGE_FS_INVALID_REQUEST",
      message: "The KnowledgeFS request is invalid.",
    });
    expect(knowledgeFsFailureFromError(missing)).toMatchObject({
      code: "KNOWLEDGE_FS_NOT_FOUND",
      message: "The requested KnowledgeFS resource was not found.",
    });
    expect(knowledgeFsFailureFromError(safeMissing).message).toBe(
      "The selected document was not found.",
    );
    expect(knowledgeFsFailureFromError(typed).message).toBe("A safe dependency message");
  });
});
