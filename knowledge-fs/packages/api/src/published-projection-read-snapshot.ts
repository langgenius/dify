import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";

/**
 * Immutable publication head captured once at the query boundary.
 *
 * Every retrieval stage in a query receives this same value so a concurrent
 * publication cutover cannot mix components from different projection sets.
 */
export interface PublishedProjectionReadSnapshot {
  readonly fingerprint: string;
  readonly headRevision: number;
  readonly knowledgeSpaceId: string;
  readonly projectionVersion: number;
  readonly publicationId: string;
  readonly tenantId: string;
}

export interface PublishedProjectionReadSnapshotLookupInput {
  readonly knowledgeSpaceId: string;
  /** Final planner mode. Readiness gates may keep a mode-specific index unavailable without
   * stopping unrelated retrieval paths. */
  readonly resolvedMode?: "deep" | "fast" | "research" | undefined;
  readonly tenantId: string;
}

export interface PublishedProjectionReadSnapshotResolver {
  resolve(
    input: PublishedProjectionReadSnapshotLookupInput,
  ): Promise<PublishedProjectionReadSnapshot>;
}

/** Optional production cutover latch. False keeps queries unavailable even if an intermediate
 * per-document bootstrap publication has already created a head. */
export interface PublishedProjectionReadinessGate {
  isQueryReady(input: PublishedProjectionReadSnapshotLookupInput): Promise<boolean>;
}

export class PublishedProjectionReadUnavailableError extends Error {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;

  constructor({ knowledgeSpaceId, tenantId }: PublishedProjectionReadSnapshotLookupInput) {
    super(`Published projection snapshot is unavailable for knowledgeSpaceId=${knowledgeSpaceId}`);
    this.name = "PublishedProjectionReadUnavailableError";
    this.knowledgeSpaceId = knowledgeSpaceId;
    this.tenantId = tenantId;
  }
}

export function createPublishedProjectionReadSnapshotResolver({
  publications,
  readiness,
}: {
  readonly publications: Pick<ProjectionSetPublicationRepository, "getPublished">;
  readonly readiness?:
    | PublishedProjectionReadinessGate
    | readonly PublishedProjectionReadinessGate[]
    | undefined;
}): PublishedProjectionReadSnapshotResolver {
  return {
    resolve: async (input) => {
      const gates = readiness ? (Array.isArray(readiness) ? readiness : [readiness]) : [];
      for (const gate of gates) {
        if (!(await gate.isQueryReady(input))) {
          throw new PublishedProjectionReadUnavailableError(input);
        }
      }
      const published = await publications.getPublished(input);
      if (!published) {
        throw new PublishedProjectionReadUnavailableError(input);
      }

      return Object.freeze({
        fingerprint: published.fingerprint,
        headRevision: published.headRevision,
        knowledgeSpaceId: published.knowledgeSpaceId,
        projectionVersion: published.projectionVersion,
        publicationId: published.id,
        tenantId: published.tenantId,
      });
    },
  };
}
