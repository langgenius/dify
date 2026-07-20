import type { Source } from "@knowledge/core";

import {
  type SourceRepository,
  SourceVersionConflictError,
} from "./source-repository";

export interface UpdateSourceWithRetryInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly maxAttempts?: number | undefined;
  /**
   * Builds the full replacement metadata from the FRESH source. Re-invoked on every retry, so a
   * concurrent writer's changes are re-read and preserved instead of clobbered.
   */
  readonly merge: (fresh: Source) => Readonly<Record<string, unknown>>;
  readonly sources: SourceRepository;
  readonly status?: Source["status"] | undefined;
}

/**
 * Optimistically-locked source metadata update: read the fresh source, rebuild metadata via
 * `merge`, and CAS-write against the read version; on a concurrent modification, re-read and
 * retry. Returns null when the source no longer exists; rethrows the conflict after
 * `maxAttempts` (default 3) so persistent contention is loud rather than silently lost.
 */
export async function updateSourceWithRetry({
  id,
  knowledgeSpaceId,
  maxAttempts = 3,
  merge,
  sources,
  status,
}: UpdateSourceWithRetryInput): Promise<Source | null> {
  let conflict: SourceVersionConflictError | undefined;

  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    const fresh = await sources.get({ id, knowledgeSpaceId });

    if (!fresh) {
      return null;
    }

    try {
      return await sources.update({
        expectedVersion: fresh.version,
        id,
        knowledgeSpaceId,
        metadata: merge(fresh),
        ...(status === undefined ? {} : { status }),
      });
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        conflict = error;
        continue;
      }

      throw error;
    }
  }

  throw conflict ?? new SourceVersionConflictError(id, -1);
}
