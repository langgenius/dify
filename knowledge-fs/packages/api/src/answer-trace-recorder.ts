import { randomUUID } from "node:crypto";

import { type AnswerTrace, AnswerTraceSchema } from "@knowledge/core";

import {
  AnswerTraceSemanticConflictError,
  reconcileAnswerTraceWrite,
} from "./answer-trace-idempotency";

export interface RecordAnswerTraceStepInput {
  /** Real step boundaries when the caller measured them; defaults to the trace timestamp. */
  readonly endedAt?: string | undefined;
  readonly metadata: Record<string, unknown>;
  readonly name: string;
  readonly startedAt?: string | undefined;
  readonly status: "error" | "ok" | "skipped";
}

interface RecordAnswerTraceBaseInput {
  readonly evidenceBundleId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode: AnswerTrace["mode"];
  readonly query: string;
  readonly steps: readonly RecordAnswerTraceStepInput[];
  readonly traceId?: string | undefined;
}

export type RecordAnswerTraceInput = RecordAnswerTraceBaseInput &
  (
    | {
        readonly capabilityGrantId: string;
        readonly permissionSnapshot?: never;
        readonly subjectId?: never;
        readonly tenantId: string;
      }
    | {
        readonly capabilityGrantId?: never;
        readonly permissionSnapshot: NonNullable<AnswerTrace["permissionSnapshot"]>;
        readonly subjectId: string;
        readonly tenantId?: never;
      }
  );

export interface AnswerTraceRecorder {
  record(input: RecordAnswerTraceInput): Promise<AnswerTrace>;
}

export interface AnswerTraceWriteRepository {
  create(trace: AnswerTrace): Promise<AnswerTrace>;
  get?(input: {
    readonly id: string;
    readonly knowledgeSpaceId: string;
  }): Promise<AnswerTrace | null>;
}

export interface AnswerTraceRecorderOptions {
  readonly generateId?: () => string;
  readonly maxSteps?: number | undefined;
  readonly now?: () => string;
  readonly repository: AnswerTraceWriteRepository;
}

export function createAnswerTraceRecorder({
  generateId = randomUUID,
  maxSteps = 100,
  now = () => new Date().toISOString(),
  repository,
}: AnswerTraceRecorderOptions): AnswerTraceRecorder {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("AnswerTrace recorder maxSteps must be at least 1");
  }

  return {
    record: async (input) => {
      if (input.steps.length > maxSteps) {
        throw new Error(`AnswerTrace recorder step count exceeds maxSteps=${maxSteps}`);
      }

      const createdAt = now();
      const trace = AnswerTraceSchema.parse({
        ...input,
        createdAt,
        id: input.traceId ?? generateId(),
        steps: input.steps.map((step) => ({
          ...step,
          endedAt: step.endedAt ?? createdAt,
          metadata: JSON.parse(JSON.stringify(step.metadata)) as Record<string, unknown>,
          startedAt: step.startedAt ?? createdAt,
        })),
      });

      return cloneAnswerTrace(await persistAnswerTrace(repository, trace));
    },
  };
}

async function persistAnswerTrace(
  repository: AnswerTraceWriteRepository,
  trace: AnswerTrace,
): Promise<AnswerTrace> {
  try {
    return await repository.create(trace);
  } catch {
    const committed = await reconcileCommittedTrace(repository, trace);
    if (committed) return committed;
  }

  try {
    // The first write may have failed before commit. Repository create is exact-payload
    // idempotent, so retrying the same trace also safely handles an uncertain acknowledgement.
    return await repository.create(trace);
  } catch (retryError) {
    const committed = await reconcileCommittedTrace(repository, trace);
    if (committed) return committed;
    throw retryError;
  }
}

async function reconcileCommittedTrace(
  repository: AnswerTraceWriteRepository,
  requested: AnswerTrace,
): Promise<AnswerTrace | null> {
  if (!repository.get) return null;
  try {
    const existing = await repository.get({
      id: requested.id,
      knowledgeSpaceId: requested.knowledgeSpaceId,
    });
    return existing ? reconcileAnswerTraceWrite(existing, requested) : null;
  } catch (error) {
    if (error instanceof AnswerTraceSemanticConflictError) throw error;
    // A transient read failure still permits one exact-payload create retry.
    return null;
  }
}

function cloneAnswerTrace(trace: AnswerTrace): AnswerTrace {
  return AnswerTraceSchema.parse(JSON.parse(JSON.stringify(trace)) as unknown);
}
