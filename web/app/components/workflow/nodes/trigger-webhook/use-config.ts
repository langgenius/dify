import { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { HttpMethod, ParameterType, WebhookHeader, WebhookParameter, WebhookTriggerNodeType } from './types'
import { getArrayElementType, isArrayType } from './types'

import { useNodesReadOnly, useWorkflow } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchWebhookUrl } from '@/service/apps'
import type { InputVar } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import Toast from '@/app/components/base/toast'
import { hasDuplicateStr } from '@/utils/var'

const useConfig = (id: string, payload: WebhookTriggerNodeType) => {
  const { t } = useTranslation()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<WebhookTriggerNodeType>(id, payload)
  const appId = useAppStore.getState().appDetail?.id
  const { isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  const handleMethodChange = useCallback((method: HttpMethod) => {
    setInputs(produce(inputs, (draft) => {
      draft.method = method
    }))
  }, [inputs, setInputs])

  const handleContentTypeChange = useCallback((contentType: string) => {
    setInputs(produce(inputs, (draft) => {
      draft.content_type = contentType
    }))
  }, [inputs, setInputs])

  // Helper function to convert ParameterType to InputVarType
  const toInputVarType = useCallback((type: ParameterType): InputVarType => {
    // Handle specific array types
    if (isArrayType(type)) {
      const elementType = getArrayElementType(type)
      switch (elementType) {
        case 'string':
          return InputVarType.textInput
        case 'number':
          return InputVarType.number
        case 'boolean':
          return InputVarType.checkbox
        case 'object':
          return InputVarType.jsonObject
        default:
          return InputVarType.textInput
      }
    }

    // Handle non-array types
    const typeMap: Record<string, InputVarType> = {
      string: InputVarType.textInput,
      number: InputVarType.number,
      boolean: InputVarType.checkbox,
      object: InputVarType.jsonObject,
      file: InputVarType.singleFile,
    }
    return typeMap[type] || InputVarType.textInput
  }, [])

  const syncVariablesInDraft = useCallback((
    draft: WebhookTriggerNodeType,
    newData: (WebhookParameter | WebhookHeader)[],
    sourceType: 'param' | 'header' | 'body',
  ) => {
    if (!draft.variables)
      draft.variables = []

    if(hasDuplicateStr(newData.map(item => item.name))) {
      Toast.notify({
        type: 'error',
        message: t('appDebug.varKeyError.keyAlreadyExists', {
          key: t('appDebug.variableConfig.varName'),
        }),
      })
      return false
    }

    // Create set of new variable names for this source
    const newVarNames = new Set(newData.map(item => item.name))

    // Find variables from current source that will be deleted and clean up references
    draft.variables
      .filter(v => v.label === sourceType && !newVarNames.has(v.variable))
      .forEach((v) => {
        // Clean up references if variable is used in other nodes
        if (isVarUsedInNodes([id, v.variable]))
          removeUsedVarInNodes([id, v.variable])
      })

    // Remove variables that no longer exist in newData for this specific source type
    draft.variables = draft.variables.filter((v) => {
      // Keep variables from other sources
      if (v.label !== sourceType) return true
      return newVarNames.has(v.variable)
    })

    // Add or update variables
    newData.forEach((item) => {
      const varName = item.name
      const existingVarIndex = draft.variables.findIndex(v => v.variable === varName)

      const inputVarType = 'type' in item
        ? toInputVarType(item.type)
        : InputVarType.textInput

      const newVar: InputVar = {
        type: inputVarType,
        label: sourceType, // Use sourceType as label to identify source
        variable: varName,
        required: item.required,
      }

      if (existingVarIndex >= 0)
        draft.variables[existingVarIndex] = newVar
      else
        draft.variables.push(newVar)
    })

    return true
  }, [toInputVarType, t, id, isVarUsedInNodes, removeUsedVarInNodes])

  const handleParamsChange = useCallback((params: WebhookParameter[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.params = params
      syncVariablesInDraft(draft, params, 'param')
    }))
  }, [inputs, setInputs, syncVariablesInDraft])

  const handleHeadersChange = useCallback((headers: WebhookHeader[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.headers = headers
      syncVariablesInDraft(draft, headers, 'header')
    }))
  }, [inputs, setInputs, syncVariablesInDraft])

  const handleBodyChange = useCallback((body: WebhookParameter[]) => {
    setInputs(produce(inputs, (draft) => {
      draft.body = body
      syncVariablesInDraft(draft, body, 'body')
    }))
  }, [inputs, setInputs, syncVariablesInDraft])

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

  const handleStatusCodeBlur = useCallback((statusCode: number) => {
    // Only clamp when user finishes editing (on blur)
    const clampedStatusCode = Math.min(Math.max(statusCode, 200), 399)

    setInputs(produce(inputs, (draft) => {
      draft.status_code = clampedStatusCode
    }))
  }, [inputs, setInputs])

  const handleResponseBodyChange = useCallback((responseBody: string) => {
    setInputs(produce(inputs, (draft) => {
      draft.response_body = responseBody
    }))
  }, [inputs, setInputs])

  const generateWebhookUrl = useCallback(async () => {
    // Idempotency: if we already have a URL, just return it.
    if (inputs.webhook_url && inputs.webhook_url.length > 0)
      return

    if (!appId)
      return

    try {
      // Call backend to generate or fetch webhook url for this node
      const response = await fetchWebhookUrl({ appId, nodeId: id })

      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = response.webhook_url
        draft.webhook_debug_url = response.webhook_debug_url
      })
      setInputs(newInputs)
    }
    catch (error: unknown) {
      // Fallback to mock URL when API is not ready or request fails
      // Keep the UI unblocked and allow users to proceed in local/dev environments.
      console.error('Failed to generate webhook URL:', error)
      const newInputs = produce(inputs, (draft) => {
        draft.webhook_url = ''
      })
      setInputs(newInputs)
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
    handleStatusCodeBlur,
    handleResponseBodyChange,
    generateWebhookUrl,
  }
}

export default useConfig
