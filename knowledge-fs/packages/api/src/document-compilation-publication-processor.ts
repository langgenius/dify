import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentCompilationCandidateEvaluator,
  DocumentCompilationPublicationCoordinator,
} from "./document-compilation-publication-coordinator";
import type {
  DocumentCompilationAttemptProcessor,
  DocumentCompilationExecutionContext,
} from "./document-compilation-runtime";
import type { PublishProjectionSetResult } from "./projection-publication-repository";

export interface DocumentCompilationPublicationProcessorOptions {
  /** Best-effort post-publication quality work; it must never invalidate an already-committed head. */
  readonly afterPublished?:
    | ((input: {
        readonly attempt: DocumentCompilationExecutionContext["attempt"];
        readonly publication: PublishProjectionSetResult;
      }) => Promise<void>)
    | undefined;
  readonly onAfterPublishedError?: ((error: unknown) => void) | undefined;
  /** Updated only after the candidate head CAS succeeds; retries are idempotent. */
  readonly assets?: Pick<DocumentAssetRepository, "updateParserStatus"> | undefined;
  /** Builds and composes the shadow candidate, leaving the attempt at projection_built. */
  readonly compileCandidate: DocumentCompilationAttemptProcessor;
  readonly coordinator: Pick<
    DocumentCompilationPublicationCoordinator,
    "evaluateAndPublishCandidate"
  >;
  readonly evaluator: DocumentCompilationCandidateEvaluator;
  readonly now?: (() => string) | undefined;
}

/**
 * Durable processor tail for candidate publication. The runtime remains the sole owner of the
 * final attempt/job completion: this processor resolves only after the publication head CAS has
 * committed and the attempt has durably reached smoke_eval_passed.
 */
export function createDocumentCompilationPublicationProcessor({
  afterPublished,
  assets,
  compileCandidate,
  coordinator,
  evaluator,
  now = () => new Date().toISOString(),
  onAfterPublishedError,
}: DocumentCompilationPublicationProcessorOptions): DocumentCompilationAttemptProcessor {
  return async (execution) => {
    if (checkpointIndex(execution) < projectionBuiltCheckpointIndex) {
      await compileCandidate(execution);
    }

    if (
      execution.attempt.checkpoint !== "projection_built" &&
      execution.attempt.checkpoint !== "smoke_eval_passed"
    ) {
      throw new Error(
        `Document compilation candidate processor stopped at checkpoint=${execution.attempt.checkpoint}`,
      );
    }

    const published = await coordinator.evaluateAndPublishCandidate({
      evaluator,
      execution,
      updatedAt: now(),
    });

    if (afterPublished) {
      try {
        await afterPublished({
          attempt: published.attempt,
          publication: published.publication,
        });
      } catch (error) {
        // Publication already committed. Findability is a routing/repair signal, not a reason to
        // mark the immutable published generation or its compilation attempt failed.
        onAfterPublishedError?.(error);
      }
    }

    if (assets) {
      const updated = await assets.updateParserStatus({
        id: execution.attempt.documentAssetId,
        knowledgeSpaceId: execution.attempt.knowledgeSpaceId,
        parserStatus: "parsed",
      });
      if (!updated || updated.version !== execution.attempt.documentVersion) {
        throw new Error(
          "Published document compilation candidate could not mark its exact asset version parsed",
        );
      }
    }
  };
}

const checkpoints = [
  "queued",
  "parsed",
  "outline_built",
  "nodes_generated",
  "projection_built",
  "smoke_eval_passed",
  "published",
] as const;
const checkpointOrder = new Map(checkpoints.map((checkpoint, index) => [checkpoint, index]));
const projectionBuiltCheckpointIndex = checkpoints.indexOf("projection_built");

function checkpointIndex(execution: DocumentCompilationExecutionContext): number {
  const index = checkpointOrder.get(execution.attempt.checkpoint);
  if (index === undefined) {
    throw new Error(
      `Unsupported document compilation checkpoint=${execution.attempt.checkpoint as string}`,
    );
  }
  return index;
}
