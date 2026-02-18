import { useMemo } from 'react'
import { useFeatures } from '@/app/components/base/features/hooks'
import { useStore } from '@/app/components/workflow/store'
import { FlowType } from '@/types/common'

export const useConfigsMap = () => {
  const appId = useStore(s => s.appId)
  const fileSettings = useFeatures(s => s.features.file)
  return useMemo(() => {
    return {
      flowId: appId!,
      flowType: FlowType.appFlow,
      fileSettings,
    }
  }, [appId])
}
