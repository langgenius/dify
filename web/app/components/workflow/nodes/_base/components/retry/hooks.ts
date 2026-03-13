import type { WorkflowRetryConfig } from './types'
import type { NodeTracing } from '@/types/workflow'
import {
  useCallback,
  useState,
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

export const useRetryDetailShowInSingleRun = () => {
  const [retryDetails, setRetryDetails] = useState<NodeTracing[] | undefined>()

  const handleRetryDetailsChange = useCallback((details: NodeTracing[] | undefined) => {
    setRetryDetails(details)
  }, [])

  return {
    retryDetails,
    handleRetryDetailsChange,
  }
}
