import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { FlowType } from '@/types/common'

export const useConfigsMap = () => {
  const appId = useStore(s => s.appId)
  return useMemo(() => {
    return {
      flowId: appId!,
      flowType: FlowType.appFlow,
    }
  }, [appId])
}
