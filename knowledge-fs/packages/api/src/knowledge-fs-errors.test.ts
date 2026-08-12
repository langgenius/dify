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

  it("uses safe family fallbacks and bounds public parameters", () => {
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
