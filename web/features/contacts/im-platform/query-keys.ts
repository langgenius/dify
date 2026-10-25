import type { ContactImSyncResult } from './types'

export const contactImPlatformQueryKeys = {
  activeSync: (organizationId: string, repositoryKey: string) =>
    [
      ...contactImPlatformQueryKeys.organization(organizationId, repositoryKey),
      'active-sync',
    ] as const,
  all: ['contacts', 'im-platform'] as const,
  integrations: (organizationId: string, repositoryKey: string) =>
    [
      ...contactImPlatformQueryKeys.organization(organizationId, repositoryKey),
      'integrations',
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
      ...contactImPlatformQueryKeys.syncItemsPrefix(runId, repositoryKey),
      result ?? 'all',
      pageSize ?? 'default',
    ] as const,
  syncItemsPrefix: (runId: string, repositoryKey: string) =>
    [...contactImPlatformQueryKeys.syncRun(runId, repositoryKey), 'items'] as const,
  syncRun: (runId: string, repositoryKey: string) =>
    [...contactImPlatformQueryKeys.all, repositoryKey, 'sync-run', runId] as const,
}
