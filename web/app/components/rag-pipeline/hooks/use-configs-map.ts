import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { FlowType } from '@/types/common'
import { Resolution, TransferMethod } from '@/types/app'

export const useConfigsMap = () => {
  const pipelineId = useStore(s => s.pipelineId)
  const fileUploadConfig = useStore(s => s.fileUploadConfig)
  return useMemo(() => {
    return {
      flowId: pipelineId!,
      flowType: FlowType.ragPipeline,
      fileSettings: {
        image: {
          enabled: false,
          detail: Resolution.high,
          number_limits: 3,
          transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        },
        fileUploadConfig,
      },
    }
  }, [pipelineId])
}
