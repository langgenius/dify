import { useCallback } from 'react'
import produce from 'immer'
import type { HttpMethod, WebhookHeader, WebhookParameter, WebhookTriggerNodeType } from './types'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { DefaultValueForm } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import type { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

const useConfig = (id: string, payload: WebhookTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<WebhookTriggerNodeType>(id, payload)
  const appId = useAppStore.getState().appDetail?.id

  const handleMethodChange = useCallback((method: HttpMethod) => {
    const newInputs = produce(inputs, (draft) => {
      draft.method = method
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleContentTypeChange = useCallback((contentType: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft['content-type'] = contentType
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleHeadersChange = useCallback((headers: WebhookHeader[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.headers = headers
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleParamsChange = useCallback((params: WebhookParameter[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.params = params
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleBodyChange = useCallback((body: WebhookParameter[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.body = body
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAsyncModeChange = useCallback((asyncMode: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.async_mode = asyncMode
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleStatusCodeChange = useCallback((statusCode: number) => {
    const newInputs = produce(inputs, (draft) => {
      draft.status_code = statusCode
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleResponseBodyChange = useCallback((responseBody: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.response_body = responseBody
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleErrorStrategyChange = useCallback((errorStrategy: ErrorHandleTypeEnum) => {
    const newInputs = produce(inputs, (draft) => {
      draft.error_strategy = errorStrategy
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleDefaultValueChange = useCallback((defaultValue: DefaultValueForm[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.default_value = defaultValue
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const generateWebhookUrl = useCallback(async () => {
    if (!appId) return null

    try {
      // TODO: Replace with actual API call when backend is ready
      // const response = await fetchWebhookUrl({ appId, nodeId: id })
      // return response.serverUrl

      // Mock implementation for now
      const mockUrl = `https://api.dify.ai/v1/webhook/${Math.random().toString(36).substring(7)}`

      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = mockUrl
      })
      setInputs(newInputs)

      return mockUrl
    }
 catch (error) {
      console.error('Failed to generate webhook URL:', error)
      return null
    }
  }, [appId, id, inputs, setInputs])

  return {
    readOnly,
    inputs,
    setInputs,
    handleMethodChange,
    handleContentTypeChange,
    handleHeadersChange,
    handleParamsChange,
    handleBodyChange,
    handleAsyncModeChange,
    handleStatusCodeChange,
    handleResponseBodyChange,
    handleErrorStrategyChange,
    handleDefaultValueChange,
    generateWebhookUrl,
  }
}

export default useConfig
