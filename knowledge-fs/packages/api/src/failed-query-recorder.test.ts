import { describe, expect, it } from "vitest";

import {
  createFailedQueryRecorder,
  failedQueryTrigger,
  readTopScore,
} from "./failed-query-recorder";
import { createInMemoryFailedQueryRepository } from "./failed-query-repository";

describe("failedQueryTrigger", () => {
  it("always captures empty retrieval", () => {
    expect(failedQueryTrigger({ finishReason: "no-retrieval-evidence" })).toBe(
      "no-retrieval-evidence",
    );
  });

  it("captures low-confidence only when a floor is set and the top score is below it", () => {
    const metadata = { topScore: 0.12 };

    // No floor configured -> answered queries are never captured.
    expect(failedQueryTrigger({ finishReason: "retrieval-evidence", metadata })).toBeNull();
    // Below the floor -> low-confidence.
    expect(
      failedQueryTrigger({
        finishReason: "retrieval-evidence",
        lowConfidenceScoreFloor: 0.3,
        metadata,
      }),
    ).toBe("low-confidence");
    // At/above the floor -> answered.
    expect(
      failedQueryTrigger({
        finishReason: "retrieval-evidence",
        lowConfidenceScoreFloor: 0.1,
        metadata,
      }),
    ).toBeNull();
    // Floor set but no score in metadata -> cannot judge, not captured.
    expect(
      failedQueryTrigger({ finishReason: "retrieval-evidence", lowConfidenceScoreFloor: 0.3 }),
    ).toBeNull();
  });

  it("reads a numeric topScore only", () => {
    expect(readTopScore({ topScore: 0.5 })).toBe(0.5);
    expect(readTopScore({ topScore: "0.5" })).toBeUndefined();
    expect(readTopScore(undefined)).toBeUndefined();
  });
});

describe("createFailedQueryRecorder", () => {
  it("records a pending-triage failed query via the repository", async () => {
    const repository = createInMemoryFailedQueryRepository({ maxFailedQueries: 10 });
    const recorder = createFailedQueryRecorder({ repository });

    const recorded = await recorder.record({
      answerTraceId: "trace-1",
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      metadata: { finishReason: "no-retrieval-evidence" },
      mode: "fast",
      permission: {
        accessChannel: "interactive",
        candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
        permissionSnapshotId: "10000000-0000-4000-8000-000000000099",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "editor-1",
      },
      query: "unanswered",
      tenantId: "tenant-1",
      trigger: "no-retrieval-evidence",
    });

    expect(recorded).toMatchObject({
      answerTraceId: "trace-1",
      metadata: { finishReason: "no-retrieval-evidence" },
      status: "pending-triage",
      trigger: "no-retrieval-evidence",
    });
  });
});
