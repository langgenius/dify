import {
  type EmbeddingModel,
  EmbeddingModelSchema,
  type JobPayload,
  type JobQueueAdapter,
  type KnowledgeNode,
  KnowledgeNodeSchema,
} from "@knowledge/core";

import { type EmbeddingModelRegistry, cloneEmbeddingModel } from "./embedding-model-registry";
import type { DenseVectorProjectionBuilder } from "./index-projection-builders";
import type {
  IndexProjectionRepository,
  PublishIndexProjectionVersionResult,
  RollbackIndexProjectionVersionResult,
} from "./index-projection-repository";
import {
  type RetrievalEvaluationMetrics,
  type RetrievalEvaluationReport,
  cloneRetrievalEvaluationReport,
} from "./retrieval-evaluation-reports";
import type { RetrievalEvaluationRunner } from "./retrieval-evaluation-runners";

export interface EmbeddingModelUpgradeThresholds {
  readonly maxNoAnswerRate: number;
  readonly minCitationHitRate: number;
  readonly minRecallAtK: number;
}

export interface StartEmbeddingModelUpgradeInput {
  readonly knowledgeSpaceId: string;
  readonly model: EmbeddingModel;
  readonly projectionVersion: number;
}

export interface StartEmbeddingModelUpgradeResult {
  readonly model: EmbeddingModel;
  readonly queueJobId: string;
}

export interface RunEmbeddingModelUpgradeInput {
  readonly evaluation: {
    readonly limit: number;
    readonly thresholds: EmbeddingModelUpgradeThresholds;
    readonly topK: number;
  };
  readonly knowledgeSpaceId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly nodes: readonly KnowledgeNode[];
  readonly projectionVersion: number;
}

export interface EmbeddingModelUpgradeResult {
  readonly decision: "published" | "rejected";
  readonly evaluation: RetrievalEvaluationReport;
  readonly model: EmbeddingModel;
  readonly projectionsBuilt: number;
  readonly published?: PublishIndexProjectionVersionResult | undefined;
  readonly rejectedReason?: string | undefined;
  readonly rollback?: RollbackIndexProjectionVersionResult | undefined;
}

export interface EmbeddingModelUpgradeWorkflow {
  run(input: RunEmbeddingModelUpgradeInput): Promise<EmbeddingModelUpgradeResult>;
  start(input: StartEmbeddingModelUpgradeInput): Promise<StartEmbeddingModelUpgradeResult>;
}

export interface EmbeddingModelUpgradeWorkflowOptions {
  readonly denseBuilder: DenseVectorProjectionBuilder;
  readonly evaluation: RetrievalEvaluationRunner;
  readonly jobs: Pick<JobQueueAdapter, "enqueue">;
  readonly maxNodes: number;
  readonly models: EmbeddingModelRegistry;
  readonly now?: () => string;
  readonly projections: IndexProjectionRepository;
}

export function createEmbeddingModelUpgradeWorkflow({
  denseBuilder,
  evaluation,
  jobs,
  maxNodes,
  models,
  now = () => new Date().toISOString(),
  projections,
}: EmbeddingModelUpgradeWorkflowOptions): EmbeddingModelUpgradeWorkflow {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Embedding model upgrade maxNodes must be at least 1");
  }

  return {
    run: async (input) => {
      validateRunEmbeddingModelUpgradeInput(input, maxNodes);
      const model = await models.get({
        modelId: input.modelId,
        version: input.modelVersion,
      });

      if (!model) {
        throw new Error(`Embedding model ${input.modelId}@${input.modelVersion} not found`);
      }

      if (model.status !== "candidate") {
        throw new Error("Embedding model upgrade requires a candidate model");
      }

      const built = await denseBuilder.build({
        model: embeddingModelRuntimeKey(model),
        nodes: input.nodes,
        projectionVersion: input.projectionVersion,
        status: "building",
      });
      const report = await evaluation.run({
        denseProjectionModel: embeddingModelRuntimeKey(model),
        denseProjectionStatuses: ["building"],
        denseProjectionVersion: input.projectionVersion,
        embeddingModel: embeddingModelRuntimeKey(model),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit: input.evaluation.limit,
        topK: input.evaluation.topK,
      });
      const rejectionReason = embeddingModelUpgradeRejectionReason(
        report.metrics,
        input.evaluation.thresholds,
      );

      if (rejectionReason) {
        const rollback = await projections.rollbackVersion({
          knowledgeSpaceId: input.knowledgeSpaceId,
          projectionVersion: input.projectionVersion,
          type: "dense-vector",
        });
        const rejected = await models.register(
          EmbeddingModelSchema.parse({
            ...model,
            metadata: {
              ...model.metadata,
              upgradeRejectedReason: rejectionReason,
              upgradedFromStatus: model.status,
            },
            status: "disabled",
            updatedAt: now(),
          }),
        );

        return {
          decision: "rejected",
          evaluation: cloneRetrievalEvaluationReport(report),
          model: rejected,
          projectionsBuilt: built.length,
          rejectedReason: rejectionReason,
          rollback,
        };
      }

      const published = await projections.publishVersion({
        knowledgeSpaceId: input.knowledgeSpaceId,
        projectionVersion: input.projectionVersion,
        type: "dense-vector",
      });
      const active = await models.register(
        EmbeddingModelSchema.parse({
          ...model,
          metadata: {
            ...model.metadata,
            upgradedFromStatus: model.status,
          },
          status: "active",
          updatedAt: now(),
        }),
      );

      return {
        decision: "published",
        evaluation: cloneRetrievalEvaluationReport(report),
        model: active,
        projectionsBuilt: built.length,
        published,
      };
    },
    start: async (input) => {
      validateStartEmbeddingModelUpgradeInput(input);
      const model = await models.register(EmbeddingModelSchema.parse(input.model));
      const queueJob = await jobs.enqueue({
        idempotencyKey: embeddingModelUpgradeIdempotencyKey(input),
        payload: toEmbeddingModelUpgradePayload(input),
        type: "embedding-model.upgrade",
      });

      return {
        model: cloneEmbeddingModel(model),
        queueJobId: queueJob.id,
      };
    },
  };
}

function validateStartEmbeddingModelUpgradeInput({
  knowledgeSpaceId,
  model,
  projectionVersion,
}: StartEmbeddingModelUpgradeInput): void {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Embedding model upgrade knowledgeSpaceId is required");
  }

  EmbeddingModelSchema.parse(model);

  if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
    throw new Error("Embedding model upgrade projectionVersion must be a positive integer");
  }
}

function validateRunEmbeddingModelUpgradeInput(
  input: RunEmbeddingModelUpgradeInput,
  maxNodes: number,
): void {
  if (!input.knowledgeSpaceId.trim()) {
    throw new Error("Embedding model upgrade knowledgeSpaceId is required");
  }

  if (!input.modelId.trim()) {
    throw new Error("Embedding model upgrade modelId is required");
  }

  if (!input.modelVersion.trim()) {
    throw new Error("Embedding model upgrade modelVersion is required");
  }

  if (!Number.isInteger(input.projectionVersion) || input.projectionVersion < 1) {
    throw new Error("Embedding model upgrade projectionVersion must be a positive integer");
  }

  if (input.nodes.length < 1) {
    throw new Error("Embedding model upgrade node batch must contain at least 1 node");
  }

  if (input.nodes.length > maxNodes) {
    throw new Error(`Embedding model upgrade node batch exceeds maxNodes=${maxNodes}`);
  }

  for (const node of input.nodes) {
    const parsed = KnowledgeNodeSchema.parse(node);

    if (parsed.knowledgeSpaceId !== input.knowledgeSpaceId) {
      throw new Error(
        "Embedding model upgrade nodes must belong to the requested knowledgeSpaceId",
      );
    }
  }

  validateEmbeddingModelUpgradeThresholds(input.evaluation.thresholds);

  if (!Number.isInteger(input.evaluation.limit) || input.evaluation.limit < 1) {
    throw new Error("Embedding model upgrade evaluation limit must be at least 1");
  }

  if (!Number.isInteger(input.evaluation.topK) || input.evaluation.topK < 1) {
    throw new Error("Embedding model upgrade evaluation topK must be at least 1");
  }
}

function validateEmbeddingModelUpgradeThresholds({
  maxNoAnswerRate,
  minCitationHitRate,
  minRecallAtK,
}: EmbeddingModelUpgradeThresholds): void {
  for (const [name, value] of Object.entries({
    maxNoAnswerRate,
    minCitationHitRate,
    minRecallAtK,
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Embedding model upgrade threshold ${name} must be between 0 and 1`);
    }
  }
}

function embeddingModelRuntimeKey({ modelId, version }: EmbeddingModel): string {
  return `${modelId}@${version}`;
}

function embeddingModelUpgradeIdempotencyKey({
  knowledgeSpaceId,
  model,
  projectionVersion,
}: StartEmbeddingModelUpgradeInput): string {
  return `${knowledgeSpaceId}:${model.modelId}:${model.version}:${projectionVersion}`;
}

function toEmbeddingModelUpgradePayload({
  knowledgeSpaceId,
  model,
  projectionVersion,
}: StartEmbeddingModelUpgradeInput): JobPayload {
  return {
    knowledgeSpaceId,
    modelId: model.modelId,
    modelVersion: model.version,
    projectionVersion,
  };
}

function embeddingModelUpgradeRejectionReason(
  metrics: RetrievalEvaluationMetrics,
  thresholds: EmbeddingModelUpgradeThresholds,
): string | null {
  const reasons: string[] = [];

  if (metrics.recallAtK < thresholds.minRecallAtK) {
    reasons.push(`recallAtK ${metrics.recallAtK} < ${thresholds.minRecallAtK}`);
  }

  if (metrics.citationHitRate < thresholds.minCitationHitRate) {
    reasons.push(`citationHitRate ${metrics.citationHitRate} < ${thresholds.minCitationHitRate}`);
  }

  if (metrics.noAnswerRate > thresholds.maxNoAnswerRate) {
    reasons.push(`noAnswerRate ${metrics.noAnswerRate} > ${thresholds.maxNoAnswerRate}`);
  }

  return reasons.length > 0 ? reasons.join("; ") : null;
}
