import { useCallback } from 'react'
import produce from 'immer'
import type { HttpMethod, WebhookHeader, WebhookParameter, WebhookTriggerNodeType } from './types'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { DefaultValueForm } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import type { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { fetchWebhookUrl } from '@/service/apps'

const useConfig = (id: string, payload: WebhookTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<WebhookTriggerNodeType>(id, payload)
  const appId = useAppStore.getState().appDetail?.id

  const handleMethodChange = useCallback((method: HttpMethod) => {
    setInputs(produce(inputs, (draft) => {
      draft.method = method
    }))
  }, [inputs, setInputs])

  const handleContentTypeChange = useCallback((contentType: string) => {
    setInputs(produce(inputs, (draft) => {
      draft['content-type'] = contentType
    }))
  }, [inputs, setInputs])

  const handleHeadersChange = useCallback((headers: WebhookHeader[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.headers = headers
    }))
  }, [inputs, setInputs])

  const handleParamsChange = useCallback((params: WebhookParameter[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.params = params
    }))
  }, [inputs, setInputs])

  const handleBodyChange = useCallback((body: WebhookParameter[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.body = body
    }))
  }, [inputs, setInputs])

  const handleAsyncModeChange = useCallback((asyncMode: boolean) => {
    setInputs(produce(inputs, (draft) => {
      draft.async_mode = asyncMode
    }))
  }, [inputs, setInputs])

  const handleStatusCodeChange = useCallback((statusCode: number) => {
    setInputs(produce(inputs, (draft) => {
      draft.status_code = statusCode
    }))
  }, [inputs, setInputs])

  const handleResponseBodyChange = useCallback((responseBody: string) => {
    setInputs(produce(inputs, (draft) => {
      draft.response_body = responseBody
    }))
  }, [inputs, setInputs])

  const handleErrorStrategyChange = useCallback((errorStrategy: ErrorHandleTypeEnum) => {
    setInputs(produce(inputs, (draft) => {
      draft.error_strategy = errorStrategy
    }))
  }, [inputs, setInputs])

  const handleDefaultValueChange = useCallback((defaultValue: DefaultValueForm[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.default_value = defaultValue
    }))
  }, [inputs, setInputs])

  const generateWebhookUrl = useCallback(async () => {
    // Idempotency: if we already have a URL, just return it.
    if (inputs.webhook_url && inputs.webhook_url.length > 0)
      return inputs.webhook_url

    // Helper to build a deterministic mock URL for local/dev usage.
    const buildMockUrl = () => `https://mock.dify.local/webhook/${appId ?? 'app'}/${id}`

    if (!appId) {
      // No appId available yet (e.g. during creation): use mock URL.
      const mockUrl = buildMockUrl()
      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = mockUrl
      })
      setInputs(newInputs)
      return mockUrl
    }

    try {
      // Call backend to generate or fetch webhook url for this node
      const response = await fetchWebhookUrl({ appId, nodeId: id })
      const url = response.serverUrl

      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = url
      })
      setInputs(newInputs)

      return url
    }
    catch (error: unknown) {
      // Fallback to mock URL when API is not ready or request fails
      // Keep the UI unblocked and allow users to proceed in local/dev environments.
      console.error('Failed to generate webhook URL:', error)
      const mockUrl = buildMockUrl()
      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = mockUrl
      })
      setInputs(newInputs)
      return mockUrl
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
