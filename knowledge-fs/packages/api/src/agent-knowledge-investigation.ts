import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { stableJson } from "@knowledge/core";
import type { AnswerTraceRecorder } from "./answer-trace-recorder";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { FailedQueryRepository } from "./failed-query-repository";
import type { QualityControlRepository } from "./quality-control";

const boundedText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .refine((value) => Array.from(value).length <= max, `Text exceeds ${max} Unicode characters`);

export const AgentKnowledgeAttemptSchema = z
  .object({
    command_id: z.string().uuid(),
    control_space_id: z.string().uuid(),
    command: z.enum([
      "search",
      "find",
      "grep",
      "ls",
      "tree",
      "cat",
      "stat",
      "diff",
      "open",
      "images",
      "image",
    ]),
    query: boundedText(4000),
    path: boundedText(4096),
    outcome: z.enum(["evidence", "empty", "error"]),
    code: z.string().max(120).nullable(),
    started_at_ms: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative(),
    delivered: z.boolean(),
    result_count: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
    evidence: boundedText(2000),
    receipt_ids: z.array(z.string().regex(/^kfs_[a-f0-9]{32}$/u)).max(50),
    authorization_fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    trace_id: z.string().max(512).nullable(),
  })
  .strict();

export const AgentKnowledgeInvestigationSchema = z
  .object({
    investigationId: z.string().uuid(),
    query: boundedText(8000),
    answer: boundedText(12000),
    status: z.enum(["completed", "interrupted"]),
    attempts: z.array(AgentKnowledgeAttemptSchema).min(1).max(64),
  })
  .strict()
  .refine(
    (body) => new Set(body.attempts.map((a) => a.command_id)).size === body.attempts.length,
    "Duplicate command IDs",
  );

export type AgentKnowledgeInvestigation = z.infer<typeof AgentKnowledgeInvestigationSchema>;
export const AgentKnowledgeIssueSchema = z
  .object({
    commandId: z.string().uuid(),
    query: z.string().trim().min(1).max(4000),
    verdict: z.enum(["retrieval-miss", "coverage-gap", "irrelevant", "uncertain"]),
  })
  .strict();
export const AgentKnowledgeAssessmentSchema = z
  .object({
    outcome: z.enum(["resolved", "unresolved", "uncertain", "interrupted"]),
    issues: z.array(AgentKnowledgeIssueSchema).max(8),
  })
  .strict();
export type AgentKnowledgeAssessment = z.infer<typeof AgentKnowledgeAssessmentSchema>;

export interface AgentKnowledgeInvestigationTriage {
  triage(
    input: AgentKnowledgeInvestigation & {
      tenantId: string;
      knowledgeSpaceId: string;
      candidateGrants: readonly string[];
    },
  ): Promise<AgentKnowledgeAssessment>;
}

export class AgentInvestigationConflictError extends Error {}

export function agentInvestigationChildId(parent: string, key: string): string {
  const hex = createHash("sha256").update(`${parent}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createAgentKnowledgeInvestigationService(options: {
  answerTraceRecorder: AnswerTraceRecorder;
  answerTraces: Pick<AnswerTraceRepository, "get">;
  failedQueries: FailedQueryRepository;
  qualityControl?: Pick<QualityControlRepository, "createBadCase"> | undefined;
  triage: AgentKnowledgeInvestigationTriage;
}) {
  return {
    capture: async (
      input: AgentKnowledgeInvestigation & {
        tenantId: string;
        knowledgeSpaceId: string;
        actorSubjectId: string;
        capabilityGrantId: string;
        candidateGrants: readonly string[];
      },
    ) => {
      const body = AgentKnowledgeInvestigationSchema.parse({
        investigationId: input.investigationId,
        query: input.query,
        answer: input.answer,
        status: input.status,
        attempts: input.attempts,
      });
      const fingerprint = createHash("sha256").update(stableJson(body)).digest("hex");
      // Snippets are only classifier input. Persisting them as arbitrary trace metadata
      // would bypass the existing evidence projection that redacts revoked documents.
      const attemptHistory = body.attempts.map((attempt) => {
        const {
          evidence: _evidence,
          authorization_fingerprint: _authorization,
          ...history
        } = attempt;
        return history;
      });
      const lookup = { id: input.investigationId, knowledgeSpaceId: input.knowledgeSpaceId };
      let trace = await options.answerTraces.get(lookup);
      const assertReplay = () => {
        if (
          trace &&
          (trace.tenantId !== input.tenantId ||
            trace.source !== "agent" ||
            trace.steps[0]?.metadata.fingerprint !== fingerprint ||
            trace.steps[0]?.metadata.actorSubjectId !== input.actorSubjectId)
        ) {
          throw new AgentInvestigationConflictError(
            "Investigation ID reused with different content or actor",
          );
        }
      };
      assertReplay();
      if (!trace) {
        const eligible = body.attempts.filter(
          (a) =>
            a.delivered &&
            a.outcome !== "error" &&
            ["search", "grep", "find", "cat", "open"].includes(a.command),
        );
        let assessment: AgentKnowledgeAssessment = { outcome: "uncertain", issues: [] };
        if (body.status === "interrupted") assessment = { outcome: "interrupted", issues: [] };
        else if (body.query.trim() && eligible.length) {
          // One batched judgment of the whole investigation, never one LLM call per command.
          assessment = AgentKnowledgeAssessmentSchema.parse(await options.triage.triage(input));
          const ids = new Set(eligible.map((a) => a.command_id));
          const seen = new Set<string>();
          const questions = new Set<string>();
          assessment.issues =
            assessment.outcome === "unresolved"
              ? assessment.issues.filter((issue) => {
                  const question = issue.query
                    .normalize("NFKC")
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/gu, " ");
                  if (
                    !ids.has(issue.commandId) ||
                    seen.has(issue.commandId) ||
                    questions.has(question)
                  )
                    return false;
                  questions.add(question);
                  seen.add(issue.commandId);
                  return true;
                })
              : [];
        }
        try {
          trace = await options.answerTraceRecorder.record({
            traceId: input.investigationId,
            tenantId: input.tenantId,
            capabilityGrantId: input.capabilityGrantId,
            knowledgeSpaceId: input.knowledgeSpaceId,
            mode: "fast",
            source: "agent",
            query: body.query || "[Image-only knowledge investigation]",
            steps: [
              {
                name: "query.generate",
                status: body.status === "completed" ? "ok" : "skipped",
                metadata: {
                  fingerprint,
                  actorSubjectId: input.actorSubjectId,
                  assessment,
                  source: "agent",
                  ...(assessment.outcome === "resolved"
                    ? { queryOutcome: "answered", finishReason: "retrieval-evidence" }
                    : assessment.outcome === "unresolved"
                      ? { queryOutcome: "no-evidence", finishReason: "no-retrieval-evidence" }
                      : {}),
                  attempts: attemptHistory,
                },
              },
            ],
          });
        } catch (error) {
          // Concurrent/retried delivery uses the first committed assessment, not a second LLM verdict.
          trace = await options.answerTraces.get(lookup);
          if (!trace) throw error;
          assertReplay();
        }
      }
      const assessment = AgentKnowledgeAssessmentSchema.parse(trace.steps[0]?.metadata.assessment);
      const records: { failedQueryId: string; badCaseId?: string; verdict: string }[] = [];
      for (const issue of assessment.issues) {
        const id = agentInvestigationChildId(input.investigationId, issue.commandId);
        const issueTrace =
          (await options.answerTraces.get({ id, knowledgeSpaceId: input.knowledgeSpaceId })) ??
          (await options.answerTraceRecorder.record({
            traceId: id,
            tenantId: input.tenantId,
            capabilityGrantId: input.capabilityGrantId,
            knowledgeSpaceId: input.knowledgeSpaceId,
            source: "agent",
            mode: "fast",
            query: issue.query,
            steps: [
              {
                name: "query.generate",
                status: "ok",
                metadata: {
                  investigationId: input.investigationId,
                  originalQuery: body.query,
                  attempts: attemptHistory,
                  source: "agent",
                  queryOutcome: "no-evidence",
                  commandId: issue.commandId,
                  finishReason: "no-retrieval-evidence",
                  verdict: issue.verdict,
                },
              },
            ],
          }));
        if (
          !issueTrace.capabilityGrantId ||
          issueTrace.tenantId !== input.tenantId ||
          issueTrace.source !== "agent" ||
          issueTrace.query !== issue.query ||
          issueTrace.steps[0]?.metadata.investigationId !== input.investigationId
        ) {
          throw new AgentInvestigationConflictError(
            "Agent issue trace conflicts with its investigation",
          );
        }
        await options.failedQueries.captureFailedRetrieval({
          ...input,
          source: "agent",
          id,
          mode: "fast",
          query: issue.query,
          answerTraceId: id,
          retrievalTraceId: input.investigationId,
          subjectId: input.actorSubjectId,
          traceCapabilityGrantId: issueTrace.capabilityGrantId,
        });
        const completed = await options.failedQueries.completeFailedRetrievalTriage({
          ...input,
          source: "agent",
          id,
          subjectId: input.actorSubjectId,
          triagedAt: trace.createdAt,
          verdict: issue.verdict,
        });
        if (!completed) throw new Error("Agent failed query disappeared during triage");
        const record: (typeof records)[number] = { failedQueryId: id, verdict: issue.verdict };
        if (issue.verdict === "retrieval-miss") {
          if (!options.qualityControl) throw new Error("Quality bad-case runtime unavailable");
          const badCase = await options.qualityControl.createBadCase({
            ...input,
            id,
            traceId: id,
            reason: "Agent retrieval miss: available answer material was not found.",
            tags: ["agent", "auto-captured", "retrieval-miss"],
          });
          record.badCaseId = badCase.id;
        }
        records.push(record);
      }
      return { traceId: trace.id, outcome: assessment.outcome, records };
    },
  };
}
