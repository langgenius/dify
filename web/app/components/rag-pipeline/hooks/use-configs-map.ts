import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { FlowType } from '@/types/common'

export const useConfigsMap = () => {
  const pipelineId = useStore(s => s.pipelineId)
  return useMemo(() => {
    return {
      flowId: pipelineId!,
      flowType: FlowType.ragPipeline,
    }
  }, [pipelineId])
}
