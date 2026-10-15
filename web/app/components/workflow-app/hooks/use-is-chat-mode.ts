import { useQuery } from '@tanstack/react-query'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

export const useIsChatMode = () => {
  const { appId } = useParams<{ appId?: string }>()
  const { data: appMode } = useQuery({
    ...consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId ?? '' } } }),
    enabled: !!appId,
    select: (appDetail) => appDetail.mode,
  })

  return appMode === AppModeEnum.ADVANCED_CHAT
}
