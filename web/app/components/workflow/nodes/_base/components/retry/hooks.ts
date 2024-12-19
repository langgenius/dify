import {
  useCallback,
  useState,
} from 'react'
import type { WorkflowRetryConfig } from './types'
import {
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'
import type { NodeTracing } from '@/types/workflow'

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
