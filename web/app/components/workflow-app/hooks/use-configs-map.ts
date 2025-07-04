import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'

export const useConfigsMap = () => {
  const appId = useStore(s => s.appId)
  return useMemo(() => {
    return {
      conversationVarsUrl: `apps/${appId}/workflows/draft/conversation-variables`,
      systemVarsUrl: `apps/${appId}/workflows/draft/system-variables`,
    }
  }, [appId])
}
