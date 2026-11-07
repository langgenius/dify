import type { QueryClient } from '@tanstack/react-query'
import type { KnowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'
import { consoleQuery } from '@/service/console'

export async function getKnowledgeFsUploadQuotaFailure(
  queryClient: QueryClient,
): Promise<KnowledgeFsTaskFailureMessageKey | undefined> {
  try {
    const features = await queryClient.query(
      consoleQuery.features.get.queryOptions({
        context: { silent: true },
        retry: false,
        staleTime: 0,
      }),
    )
    const quota = features.documents_upload_quota
    if (
      !Number.isSafeInteger(quota.size) ||
      quota.size < 0 ||
      !Number.isSafeInteger(quota.limit) ||
      quota.limit < -1
    )
      return 'taskFailure.documentCountQuotaUnavailable'
    if (quota.limit !== -1 && quota.size >= quota.limit)
      return 'taskFailure.documentCountQuotaExceeded'
  } catch {
    return 'taskFailure.documentCountQuotaUnavailable'
  }

  try {
    const quota = await queryClient.query(
      consoleQuery.features.vectorSpace.get.queryOptions({
        context: { silent: true },
        retry: false,
        staleTime: 0,
      }),
    )
    if (
      !Number.isFinite(quota.size) ||
      quota.size < 0 ||
      !Number.isSafeInteger(quota.limit) ||
      quota.limit < -1 ||
      quota.usage_unknown
    )
      return 'taskFailure.vectorSpaceQuotaUnavailable'
    if (quota.limit !== -1 && quota.size >= quota.limit)
      return 'taskFailure.vectorSpaceQuotaExceeded'
  } catch {
    return 'taskFailure.vectorSpaceQuotaUnavailable'
  }
}
