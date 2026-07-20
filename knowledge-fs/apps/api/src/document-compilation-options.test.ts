import { describe, expect, it } from "vitest";

import {
  assertApiDocumentWriteSafety,
  createApiDocumentCompilationOptions,
} from "./document-compilation-options";

describe("createApiDocumentCompilationOptions", () => {
  it("keeps the durable runtime disabled by default", () => {
    expect(createApiDocumentCompilationOptions({})).toBeUndefined();
    expect(
      createApiDocumentCompilationOptions({ KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME: "off" }),
    ).toBeUndefined();
  });

  it("parses an explicitly enabled bounded runtime profile", () => {
    expect(
      createApiDocumentCompilationOptions({
        KNOWLEDGE_DOCUMENT_COMPILATION_BATCH_SIZE: "20",
        KNOWLEDGE_DOCUMENT_COMPILATION_LEASE_MS: "90000",
        KNOWLEDGE_DOCUMENT_COMPILATION_MAX_ATTEMPTS: "7",
        KNOWLEDGE_DOCUMENT_COMPILATION_OUTBOX_VISIBILITY_MS: "120000",
        KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS: "2000",
        KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS: "60000",
        KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME: "on",
        KNOWLEDGE_DOCUMENT_COMPILATION_TICK_MS: "500",
      }),
    ).toEqual({
      batchSize: 20,
      leaseMs: 90_000,
      maxAttempts: 7,
      outboxVisibilityMs: 120_000,
      retryBaseMs: 2_000,
      retryMaxMs: 60_000,
      tickMs: 500,
    });
  });

  it("fails fast on ambiguous switches and invalid retry bounds", () => {
    expect(() =>
      createApiDocumentCompilationOptions({
        KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME: "maybe",
      }),
    ).toThrow("KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME must be on/true/1 or off/false/0");
    expect(() =>
      createApiDocumentCompilationOptions({
        KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS: "5000",
        KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS: "4999",
        KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME: "true",
      }),
    ).toThrow("KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS must be an integer of at least 5000");
  });
});

describe("assertApiDocumentWriteSafety", () => {
  it("rejects database-backed writes when durable compilation is disabled", () => {
    expect(() =>
      assertApiDocumentWriteSafety({
        durableCompilationEnabled: false,
        production: false,
        usesDatabaseRepositories: true,
      }),
    ).toThrow("requires KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on");
  });

  it("rejects the local repository fallback in production", () => {
    expect(() =>
      assertApiDocumentWriteSafety({
        durableCompilationEnabled: true,
        production: true,
        usesDatabaseRepositories: false,
      }),
    ).toThrow("Production API requires database repositories");
  });

  it("allows durable database production and the explicit development fallback", () => {
    expect(() =>
      assertApiDocumentWriteSafety({
        durableCompilationEnabled: true,
        production: true,
        usesDatabaseRepositories: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertApiDocumentWriteSafety({
        durableCompilationEnabled: false,
        production: false,
        usesDatabaseRepositories: false,
      }),
    ).not.toThrow();
  });
});
