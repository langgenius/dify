import type { SourceConnectionRepository, SourceOAuthProviderRegistry } from "./source-connection";
import type { SourceSecretStore } from "./source-secret-store";

export interface SourceConnectionSecretCleanupRuntime {
  start(): () => Promise<void>;
  stop(): Promise<void>;
  tick(): Promise<{ readonly claimed: number; readonly deleted: number; readonly failed: number }>;
}

/**
 * Deletes retired connection credentials and PKCE verifiers behind a durable lease. OAuth revoke
 * happens before physical deletion, but only after the connection row has already been locally
 * revoked; provider downtime can therefore delay cleanup without restoring access.
 */
export function createSourceConnectionSecretCleanupRuntime(input: {
  readonly batchSize?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly leaseMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly oauthRevokeTimeoutMs?: number | undefined;
  readonly oauth: SourceOAuthProviderRegistry;
  readonly repository: Pick<
    SourceConnectionRepository,
    "claimSecretCleanup" | "completeSecretCleanup" | "failSecretCleanup"
  >;
  readonly retryMs?: number | undefined;
  readonly secrets: SourceSecretStore;
  readonly workerId: string;
}): SourceConnectionSecretCleanupRuntime {
  const batchSize = input.batchSize ?? 20;
  const intervalMs = input.intervalMs ?? 10_000;
  const leaseMs = input.leaseMs ?? 60_000;
  const now = input.now ?? Date.now;
  const oauthRevokeTimeoutMs = input.oauthRevokeTimeoutMs ?? 30_000;
  const retryMs = input.retryMs ?? 60_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lane: Promise<unknown> = Promise.resolve();
  let stopping = false;
  const tick = async () => {
    const timestamp = now();
    const refs = await input.repository.claimSecretCleanup({
      leaseExpiresAt: new Date(timestamp + leaseMs).toISOString(),
      limit: batchSize,
      now: new Date(timestamp).toISOString(),
      workerId: input.workerId,
    });
    let deleted = 0;
    let failed = 0;
    for (const ref of refs) {
      try {
        if (ref.remoteRevokeRequired) {
          const oauth = input.oauth.get(ref.providerId);
          if (!oauth) throw new Error("OAuth provider unavailable for durable revoke");
          const stored = await input.secrets.get({
            knowledgeSpaceId: ref.knowledgeSpaceId,
            ref: ref.credentialRef,
            sourceId: ref.connectionId,
            tenantId: ref.tenantId,
          });
          if (stored) {
            await oauth.revoke({
              ...(typeof stored.credentials.accessToken === "string"
                ? { accessToken: stored.credentials.accessToken }
                : {}),
              ...(typeof stored.credentials.refreshToken === "string"
                ? { refreshToken: stored.credentials.refreshToken }
                : {}),
              signal: AbortSignal.timeout(oauthRevokeTimeoutMs),
            });
          }
        }
        await input.secrets.delete({
          knowledgeSpaceId: ref.knowledgeSpaceId,
          ref: ref.credentialRef,
          sourceId: ref.connectionId,
          tenantId: ref.tenantId,
        });
        await input.repository.completeSecretCleanup({
          leaseToken: requiredLeaseToken(ref),
          now: new Date(now()).toISOString(),
          refId: ref.id,
          rowVersion: ref.rowVersion,
          workerId: input.workerId,
        });
        deleted += 1;
      } catch {
        await input.repository.failSecretCleanup({
          errorCode: "SOURCE_CONNECTION_SECRET_CLEANUP_FAILED",
          leaseToken: requiredLeaseToken(ref),
          nextAttemptAt: new Date(now() + retryMs).toISOString(),
          now: new Date(now()).toISOString(),
          refId: ref.id,
          rowVersion: ref.rowVersion,
          workerId: input.workerId,
        });
        failed += 1;
      }
    }
    return { claimed: refs.length, deleted, failed };
  };
  return {
    tick,
    start: () => {
      if (!timer) {
        timer = setInterval(() => {
          if (stopping) return;
          lane = lane.then(tick, tick).catch(() => undefined);
        }, intervalMs);
        timer.unref?.();
      }
      return async () => {
        stopping = true;
        if (timer) clearInterval(timer);
        timer = undefined;
        await lane;
      };
    },
    stop: async () => {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await lane;
    },
  };
}

function requiredLeaseToken(ref: { readonly leaseToken?: string | undefined }): string {
  if (!ref.leaseToken) throw new Error("Connection secret cleanup lease is missing");
  return ref.leaseToken;
}
