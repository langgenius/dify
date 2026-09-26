import { skipToken, useQuery } from '@tanstack/react-query'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

export const useIsChatMode = () => {
  const appId = useStore((state) => state.appId)
  const { data: isChatMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (app) => app.mode === AppModeEnum.ADVANCED_CHAT,
    }),
  )

  return isChatMode ?? false
}
