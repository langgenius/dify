'use client'

import type { AppInstanceBasicInfo } from '@dify/contracts/enterprise/types.gen'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/service/base'

const SOURCE_APP_DETAIL_QUERY_KEY = 'source-app-detail'

type SourceAppDetail = {
  id?: string
}

type SourceAppAvailability = {
  canCreateRelease: boolean
  isChecking: boolean
  sourceAppUnavailable: boolean
}

export function useSourceAppAvailability(
  appInstance?: Pick<AppInstanceBasicInfo, 'sourceAppAvailable' | 'sourceAppId'>,
): SourceAppAvailability {
  const sourceAppId = appInstance?.sourceAppId
  const shouldVerifySourceApp = Boolean(sourceAppId && appInstance?.sourceAppAvailable !== false)
  const sourceAppDetailQuery = useQuery({
    queryKey: [SOURCE_APP_DETAIL_QUERY_KEY, sourceAppId],
    queryFn: async () => {
      if (!sourceAppId)
        return true

      const sourceApp = await get<SourceAppDetail>(`/apps/${sourceAppId}`, {}, { silent: true })
      return sourceApp.id === sourceAppId
    },
    enabled: shouldVerifySourceApp,
    retry: false,
  })

  if (!appInstance) {
    return {
      canCreateRelease: false,
      isChecking: false,
      sourceAppUnavailable: false,
    }
  }

  if (appInstance.sourceAppAvailable === false) {
    return {
      canCreateRelease: false,
      isChecking: false,
      sourceAppUnavailable: true,
    }
  }

  if (!sourceAppId) {
    return {
      canCreateRelease: true,
      isChecking: false,
      sourceAppUnavailable: false,
    }
  }

  if (sourceAppDetailQuery.isLoading) {
    return {
      canCreateRelease: false,
      isChecking: true,
      sourceAppUnavailable: false,
    }
  }

  const sourceAppUnavailable = sourceAppDetailQuery.isError || sourceAppDetailQuery.data === false

  return {
    canCreateRelease: !sourceAppUnavailable,
    isChecking: false,
    sourceAppUnavailable,
  }
}
