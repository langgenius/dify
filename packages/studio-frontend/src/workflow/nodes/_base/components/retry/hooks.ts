import type { WorkflowRetryConfig } from '@/app/components/workflow/nodes/_base/components/retry/types'
import {
  useCallback,
} from 'react'
import {
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'

export const useRetryConfig = (
  id: string,
) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const handleRetryConfigChange = useCallback((value?: WorkflowRetryConfig) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        retry_config: value,
      },
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

  return {
    handleRetryConfigChange,
  }
}
