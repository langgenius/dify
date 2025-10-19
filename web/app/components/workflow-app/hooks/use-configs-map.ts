import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { FlowType } from '@/types/common'
import { useFeatures } from '@/app/components/base/features/hooks'

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
