import { describe, expect, it } from "vitest";

import { getTenantScopedAnswerTrace } from "./answer-trace-access";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

import type { AnswerTrace, AuthSubject } from "@knowledge/core";

const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const CREATED_AT = "2026-05-15T00:00:00.000Z";

describe("getTenantScopedAnswerTrace", () => {
  it("returns the trace only when its knowledge space belongs to the subject tenant", async () => {
    const trace = answerTrace();
    const answerTraceRepository = {
      getById: async (id: string) => {
        expect(id).toBe(TRACE_ID);
        return trace;
      },
    } as unknown as AnswerTraceRepository;
    const spaces = {
      get: async (input: { readonly id: string; readonly tenantId: string }) => {
        expect(input).toEqual({ id: SPACE_ID, tenantId: "tenant-1" });
        return { id: SPACE_ID };
      },
    } as unknown as KnowledgeSpaceRepository;

    await expect(
      getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject: subject("tenant-1"),
        traceId: TRACE_ID,
      }),
    ).resolves.toEqual(trace);
  });

  it("hides missing or cross-tenant traces behind null", async () => {
    const trace = answerTrace();
    const answerTraceRepository = {
      getById: async () => trace,
    } as unknown as AnswerTraceRepository;
    const spaces = {
      get: async () => null,
    } as unknown as KnowledgeSpaceRepository;

    await expect(
      getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject: subject("other-tenant"),
        traceId: TRACE_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      getTenantScopedAnswerTrace({
        answerTraceRepository: {
          getById: async () => null,
        } as unknown as AnswerTraceRepository,
        spaces,
        subject: subject("tenant-1"),
        traceId: TRACE_ID,
      }),
    ).resolves.toBeNull();
  });
});

function subject(tenantId: string): AuthSubject {
  return {
    scopes: ["knowledge-spaces:read"],
    subjectId: "subject-1",
    tenantId,
  };
}

function answerTrace(): AnswerTrace {
  return {
    createdAt: CREATED_AT,
    id: TRACE_ID,
    knowledgeSpaceId: SPACE_ID,
    mode: "fast",
    query: "What changed?",
    steps: [],
  };
}
