import type { ContactImSyncResult } from './types'

export const contactImPlatformQueryKeys = {
  activeSync: (organizationId: string, repositoryKey: string) =>
    [
      ...contactImPlatformQueryKeys.organization(organizationId, repositoryKey),
      'active-sync',
    ] as const,
  all: ['contacts', 'im-platform'] as const,
  integration: (organizationId: string, repositoryKey: string) =>
    [
      ...contactImPlatformQueryKeys.organization(organizationId, repositoryKey),
      'integration',
    ] as const,
  organization: (organizationId: string, repositoryKey: string) =>
    [...contactImPlatformQueryKeys.all, repositoryKey, organizationId] as const,
  providers: (organizationId: string, repositoryKey: string) =>
    [
      ...contactImPlatformQueryKeys.organization(organizationId, repositoryKey),
      'providers',
    ] as const,
  syncItems: (
    runId: string,
    repositoryKey: string,
    result?: ContactImSyncResult,
    pageSize?: number,
  ) =>
    [
      ...contactImPlatformQueryKeys.syncRun(runId, repositoryKey),
      'items',
      result ?? 'all',
      pageSize ?? 'default',
    ] as const,
  syncRun: (runId: string, repositoryKey: string) =>
    [...contactImPlatformQueryKeys.all, repositoryKey, 'sync-run', runId] as const,
}
