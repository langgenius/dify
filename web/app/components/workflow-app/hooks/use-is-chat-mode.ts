import { skipToken, useQuery } from '@tanstack/react-query'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

export const useIsChatMode = () => {
  const { appId } = useParams<{ appId?: string }>()
  const { data: appMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (appDetail) => appDetail.mode,
    }),
  )

  return appMode === 'advanced-chat'
}
