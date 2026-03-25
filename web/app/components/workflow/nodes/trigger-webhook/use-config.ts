import type { HttpMethod, WebhookHeader, WebhookParameter, WebhookTriggerNodeType } from './types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { useNodesReadOnly, useWorkflow } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { fetchWebhookUrl } from '@/service/apps'
import {
  updateContentType,
  updateMethod,
  updateSimpleField,
  updateSourceFields,
  updateWebhookUrls,
} from './use-config.helpers'

export const DEFAULT_STATUS_CODE = 200
export const MAX_STATUS_CODE = 399
export const normalizeStatusCode = (statusCode: number) => Math.min(Math.max(statusCode, DEFAULT_STATUS_CODE), MAX_STATUS_CODE)

export const useConfig = (id: string, payload: WebhookTriggerNodeType) => {
  const { t } = useTranslation()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<WebhookTriggerNodeType>(id, payload)
  const appId = useAppStore.getState().appDetail?.id
  const { isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  const notifyVarError = useCallback((key: string) => {
    const fieldLabel = key === 'variableConfig.varName'
      ? t('variableConfig.varName', { ns: 'appDebug' })
      : key
    const message = key.startsWith('varKeyError.')
      ? t(key as never, { ns: 'appDebug', key: fieldLabel })
      : t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: fieldLabel })

    toast.error(message)
  }, [t])

  const handleMethodChange = useCallback((method: HttpMethod) => {
    setInputs(updateMethod(inputs, method))
  }, [inputs, setInputs])

  const handleContentTypeChange = useCallback((contentType: string) => {
    setInputs(updateContentType({
      inputs,
      id,
      contentType,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    }))
  }, [inputs, setInputs, id, isVarUsedInNodes, removeUsedVarInNodes])

  const handleParamsChange = useCallback((params: WebhookParameter[]) => {
    setInputs(updateSourceFields({
      inputs,
      id,
      sourceType: 'param',
      nextData: params,
      notifyError: notifyVarError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    }))
  }, [id, inputs, isVarUsedInNodes, notifyVarError, removeUsedVarInNodes, setInputs])

  const handleHeadersChange = useCallback((headers: WebhookHeader[]) => {
    setInputs(updateSourceFields({
      inputs,
      id,
      sourceType: 'header',
      nextData: headers,
      notifyError: notifyVarError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    }))
  }, [id, inputs, isVarUsedInNodes, notifyVarError, removeUsedVarInNodes, setInputs])

  const handleBodyChange = useCallback((body: WebhookParameter[]) => {
    setInputs(updateSourceFields({
      inputs,
      id,
      sourceType: 'body',
      nextData: body,
      notifyError: notifyVarError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    }))
  }, [id, inputs, isVarUsedInNodes, notifyVarError, removeUsedVarInNodes, setInputs])

  const handleAsyncModeChange = useCallback((asyncMode: boolean) => {
    setInputs(updateSimpleField(inputs, 'async_mode', asyncMode))
  }, [inputs, setInputs])

  const handleStatusCodeChange = useCallback((statusCode: number) => {
    setInputs(updateSimpleField(inputs, 'status_code', statusCode))
  }, [inputs, setInputs])

  const handleResponseBodyChange = useCallback((responseBody: string) => {
    setInputs(updateSimpleField(inputs, 'response_body', responseBody))
  }, [inputs, setInputs])

  const generateWebhookUrl = useCallback(async () => {
    // Idempotency: if we already have a URL, just return it.
    if (inputs.webhook_url && inputs.webhook_url.length > 0)
      return

    if (!appId)
      return

    try {
      const response = await fetchWebhookUrl({ appId, nodeId: id })
      setInputs(updateWebhookUrls(inputs, response.webhook_url, response.webhook_debug_url))
    }
    catch (error: unknown) {
      console.error('Failed to generate webhook URL:', error)
      setInputs(updateWebhookUrls(inputs, ''))
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
    generateWebhookUrl,
  }
}
