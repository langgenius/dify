export type ResearchRetrievalExecutionKind = "durable" | "interactive";
export type ResearchRetrievalCheckpointMode = "none" | "replay-safe-boundaries";
export type ResearchRetrievalBudgetCounter =
  | "modelCalls"
  | "openedResources"
  | "retrievalSteps"
  | "rounds"
  | "supplementalSearches";
export type ResearchRetrievalBudgetExhaustedReason =
  | "model-calls"
  | "opened-resources"
  | "retrieval-steps"
  | "rounds"
  | "supplemental-searches"
  | "wall-clock";

export interface ResearchRetrievalExecutionPolicy {
  readonly checkpointMode: ResearchRetrievalCheckpointMode;
  readonly kind: ResearchRetrievalExecutionKind;
  readonly maxConcurrentTreeSelections: number;
  readonly maxDocuments: number;
  readonly maxEvidencePerRange: number;
  readonly maxFinalItems: number;
  readonly maxHitsPerDocument: number;
  readonly maxModelCalls: number;
  readonly maxOpenedResources: number;
  readonly maxQueueItems: number;
  readonly maxRetrievalSteps: number;
  readonly maxRounds: number;
  readonly maxSupplementalSearches: number;
  /** Maximum sibling levels a single document may traverse. */
  readonly maxTreeDepth: number;
  readonly maxTreeSelectionAttempts: number;
  readonly maxValueNodesPerOutline: number;
  readonly strategyVersion: "pageindex-v2" | "research-evidence-v3";
  readonly wallClockMs: number;
}

export const InteractiveResearchRetrievalPolicy: ResearchRetrievalExecutionPolicy = Object.freeze({
  checkpointMode: "none",
  kind: "interactive",
  maxConcurrentTreeSelections: 3,
  maxDocuments: 5,
  maxEvidencePerRange: 8,
  maxFinalItems: 20,
  maxHitsPerDocument: 5,
  maxModelCalls: 10,
  maxOpenedResources: 20,
  maxQueueItems: 10,
  maxRetrievalSteps: 4,
  maxRounds: 1,
  maxSupplementalSearches: 1,
  maxTreeDepth: 6,
  maxTreeSelectionAttempts: 2,
  maxValueNodesPerOutline: 2,
  strategyVersion: "pageindex-v2",
  wallClockMs: 30_000,
});

export const DurableResearchRetrievalPolicy: ResearchRetrievalExecutionPolicy = Object.freeze({
  checkpointMode: "replay-safe-boundaries",
  kind: "durable",
  maxConcurrentTreeSelections: 3,
  maxDocuments: 10,
  maxEvidencePerRange: 10,
  maxFinalItems: 40,
  maxHitsPerDocument: 8,
  maxModelCalls: 40,
  maxOpenedResources: 60,
  maxQueueItems: 30,
  maxRetrievalSteps: 20,
  maxRounds: 3,
  maxSupplementalSearches: 2,
  maxTreeDepth: 12,
  maxTreeSelectionAttempts: 2,
  maxValueNodesPerOutline: 3,
  strategyVersion: "pageindex-v2",
  wallClockMs: 300_000,
});

/**
 * Research Evidence V3 policies. The legacy policies above remain frozen because an in-flight V2
 * PageIndex checkpoint may already contain counters that exceed the V3 limits. Fresh requests and
 * V3 checkpoints use these policies instead: at most one planner call, one set-level evidence
 * judge, and (for durable work only) one deterministic supplemental retrieval round. The third
 * model-call slot remains only so checkpoints written by the former bounded-recovery contract can
 * still resume safely after deployment.
 */
export const InteractiveResearchEvidenceRetrievalPolicy: ResearchRetrievalExecutionPolicy =
  Object.freeze({
    checkpointMode: "none",
    kind: "interactive",
    maxConcurrentTreeSelections: 1,
    maxDocuments: 10,
    maxEvidencePerRange: 8,
    maxFinalItems: 20,
    maxHitsPerDocument: 8,
    maxModelCalls: 3,
    maxOpenedResources: 20,
    maxQueueItems: 20,
    maxRetrievalSteps: 4,
    maxRounds: 1,
    maxSupplementalSearches: 0,
    maxTreeDepth: 1,
    maxTreeSelectionAttempts: 1,
    maxValueNodesPerOutline: 4,
    strategyVersion: "research-evidence-v3",
    wallClockMs: 60_000,
  });

export const DurableResearchEvidenceRetrievalPolicy: ResearchRetrievalExecutionPolicy =
  Object.freeze({
    checkpointMode: "replay-safe-boundaries",
    kind: "durable",
    maxConcurrentTreeSelections: 1,
    maxDocuments: 20,
    maxEvidencePerRange: 10,
    maxFinalItems: 40,
    maxHitsPerDocument: 10,
    maxModelCalls: 3,
    maxOpenedResources: 40,
    maxQueueItems: 40,
    maxRetrievalSteps: 5,
    maxRounds: 2,
    maxSupplementalSearches: 1,
    maxTreeDepth: 1,
    maxTreeSelectionAttempts: 1,
    maxValueNodesPerOutline: 6,
    strategyVersion: "research-evidence-v3",
    wallClockMs: 180_000,
  });

export function validateResearchRetrievalPolicy(
  policy: ResearchRetrievalExecutionPolicy,
): ResearchRetrievalExecutionPolicy {
  if (
    policy.strategyVersion !== "pageindex-v2" &&
    policy.strategyVersion !== "research-evidence-v3"
  ) {
    throw new Error("Research retrieval policy strategyVersion is unsupported");
  }
  const integerFields = [
    "maxConcurrentTreeSelections",
    "maxDocuments",
    "maxEvidencePerRange",
    "maxFinalItems",
    "maxHitsPerDocument",
    "maxModelCalls",
    "maxOpenedResources",
    "maxQueueItems",
    "maxRetrievalSteps",
    "maxRounds",
    "maxTreeDepth",
    "maxTreeSelectionAttempts",
    "maxValueNodesPerOutline",
    "wallClockMs",
  ] as const;
  for (const field of integerFields) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] < 1) {
      throw new Error(`Research retrieval policy ${field} must be a positive integer`);
    }
  }
  if (!Number.isSafeInteger(policy.maxSupplementalSearches) || policy.maxSupplementalSearches < 0) {
    throw new Error(
      "Research retrieval policy maxSupplementalSearches must be a non-negative integer",
    );
  }
  if (policy.kind === "interactive") {
    if (policy.checkpointMode !== "none") {
      throw new Error("Research retrieval interactive checkpointMode must equal none");
    }
    if (policy.maxRounds !== 1) {
      throw new Error("Research retrieval interactive maxRounds must equal 1");
    }
    if (policy.maxSupplementalSearches > 1) {
      throw new Error("Research retrieval interactive maxSupplementalSearches must not exceed 1");
    }
  } else if (policy.checkpointMode !== "replay-safe-boundaries") {
    throw new Error("Research retrieval durable checkpointMode must equal replay-safe-boundaries");
  }
  return policy;
}

export interface ResearchRetrievalBudgetSnapshot {
  readonly elapsedMs: number;
  readonly exhaustedReasons: readonly ResearchRetrievalBudgetExhaustedReason[];
  readonly modelCalls: number;
  readonly openedResources: number;
  readonly retrievalSteps: number;
  readonly rounds: number;
  readonly supplementalSearches: number;
}

export interface ResearchRetrievalBudget {
  consume(counter: ResearchRetrievalBudgetCounter, amount?: number): boolean;
  /** Releases a conservative reservation when a guarded operation proves it did not execute. */
  refund(counter: ResearchRetrievalBudgetCounter, amount?: number): void;
  snapshot(): ResearchRetrievalBudgetSnapshot;
}

export function createResearchRetrievalBudget(
  policy: ResearchRetrievalExecutionPolicy,
  now: () => number = Date.now,
  initial?: ResearchRetrievalBudgetSnapshot | undefined,
): ResearchRetrievalBudget {
  validateResearchRetrievalPolicy(policy);
  const startedAt = now();
  const initialElapsedMs = initial?.elapsedMs ?? 0;
  if (!Number.isFinite(initialElapsedMs) || initialElapsedMs < 0) {
    throw new Error("Research retrieval initial elapsedMs must be non-negative and finite");
  }
  const counters: Record<ResearchRetrievalBudgetCounter, number> = {
    modelCalls: initial?.modelCalls ?? 0,
    openedResources: initial?.openedResources ?? 0,
    retrievalSteps: initial?.retrievalSteps ?? 0,
    rounds: initial?.rounds ?? 0,
    supplementalSearches: initial?.supplementalSearches ?? 0,
  };
  for (const [counter, value] of Object.entries(counters) as Array<
    [ResearchRetrievalBudgetCounter, number]
  >) {
    if (!Number.isSafeInteger(value) || value < 0 || value > budgetLimit(policy, counter)) {
      throw new Error(`Research retrieval initial ${counter} is outside the policy limit`);
    }
  }
  const exhausted = new Set<ResearchRetrievalBudgetExhaustedReason>(
    initial?.exhaustedReasons ?? [],
  );

  const elapsedMs = (): number => initialElapsedMs + Math.max(0, now() - startedAt);

  const checkWallClock = (): boolean => {
    if (elapsedMs() <= policy.wallClockMs) {
      return true;
    }
    exhausted.add("wall-clock");
    return false;
  };

  return {
    consume: (counter, amount = 1) => {
      if (!Number.isSafeInteger(amount) || amount < 1) {
        throw new Error("Research retrieval budget consumption must be a positive integer");
      }
      if (!checkWallClock()) {
        return false;
      }
      const limit = budgetLimit(policy, counter);
      if (counters[counter] + amount > limit) {
        exhausted.add(budgetReason(counter));
        return false;
      }
      counters[counter] += amount;
      return true;
    },
    refund: (counter, amount = 1) => {
      if (!Number.isSafeInteger(amount) || amount < 1) {
        throw new Error("Research retrieval budget refund must be a positive integer");
      }
      counters[counter] = Math.max(0, counters[counter] - amount);
    },
    snapshot: () => {
      checkWallClock();
      return {
        elapsedMs: elapsedMs(),
        exhaustedReasons: [...exhausted],
        ...counters,
      };
    },
  };
}

export interface ResearchRetrievalWorkQuantity {
  readonly modelCalls: number;
  readonly openedResources: number;
  readonly retrievalSteps: number;
}

export interface ResearchRetrievalWorkEstimate {
  readonly expected: ResearchRetrievalWorkQuantity;
  readonly maximum: ResearchRetrievalWorkQuantity;
  readonly minimum: ResearchRetrievalWorkQuantity;
}

export function estimateResearchRetrievalWork(
  policy: ResearchRetrievalExecutionPolicy,
  options: { readonly includeFinalSynthesis: boolean },
): ResearchRetrievalWorkEstimate {
  validateResearchRetrievalPolicy(policy);
  const synthesisCalls = options.includeFinalSynthesis ? 1 : 0;
  if (policy.strategyVersion === "research-evidence-v3") {
    const retrievalModelCalls = Math.min(policy.maxModelCalls, 2);
    return {
      expected: {
        modelCalls: retrievalModelCalls + synthesisCalls,
        openedResources: Math.min(
          policy.maxOpenedResources,
          Math.max(1, Math.ceil(policy.maxQueueItems / 2)),
        ),
        retrievalSteps: Math.min(
          policy.maxRetrievalSteps,
          2 + Math.min(policy.maxSupplementalSearches, 1),
        ),
      },
      maximum: {
        modelCalls: policy.maxModelCalls + synthesisCalls,
        openedResources: policy.maxOpenedResources,
        retrievalSteps: policy.maxRetrievalSteps,
      },
      minimum: {
        // A simple query skips the planner model call, but still runs one evidence-set judge.
        modelCalls: 1 + synthesisCalls,
        openedResources: 0,
        retrievalSteps: 1,
      },
    };
  }
  const expectedDocuments = Math.max(1, Math.ceil(policy.maxDocuments / 2));
  // Most useful paths resolve within the root, chapter, and section levels. The hard maximum still
  // comes from maxModelCalls, but dry-run estimation must scale with layered traversal depth instead
  // of assuming one model call per selected document.
  const expectedTreeDepth = Math.min(policy.maxTreeDepth, 3);
  const expectedFallbackCalls = Math.min(policy.maxSupplementalSearches, 1);
  return {
    expected: {
      modelCalls:
        Math.min(
          policy.maxModelCalls,
          expectedDocuments * expectedTreeDepth + expectedFallbackCalls,
        ) + synthesisCalls,
      openedResources: Math.min(
        policy.maxOpenedResources,
        Math.max(1, Math.ceil(policy.maxQueueItems / 2)),
      ),
      retrievalSteps: Math.min(
        policy.maxRetrievalSteps,
        2 + Math.min(policy.maxSupplementalSearches, 1),
      ),
    },
    maximum: {
      modelCalls: policy.maxModelCalls + synthesisCalls,
      openedResources: policy.maxOpenedResources,
      retrievalSteps: policy.maxRetrievalSteps,
    },
    minimum: {
      modelCalls: synthesisCalls,
      openedResources: 0,
      retrievalSteps: 1,
    },
  };
}

function budgetLimit(
  policy: ResearchRetrievalExecutionPolicy,
  counter: ResearchRetrievalBudgetCounter,
): number {
  switch (counter) {
    case "modelCalls":
      return policy.maxModelCalls;
    case "openedResources":
      return policy.maxOpenedResources;
    case "retrievalSteps":
      return policy.maxRetrievalSteps;
    case "rounds":
      return policy.maxRounds;
    case "supplementalSearches":
      return policy.maxSupplementalSearches;
  }
}

function budgetReason(
  counter: ResearchRetrievalBudgetCounter,
): ResearchRetrievalBudgetExhaustedReason {
  switch (counter) {
    case "modelCalls":
      return "model-calls";
    case "openedResources":
      return "opened-resources";
    case "retrievalSteps":
      return "retrieval-steps";
    case "rounds":
      return "rounds";
    case "supplementalSearches":
      return "supplemental-searches";
  }
}
