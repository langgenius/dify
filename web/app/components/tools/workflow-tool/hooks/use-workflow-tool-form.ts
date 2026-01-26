'use client'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '@/app/components/tools/types'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { VarType } from '@/app/components/workflow/types'
import { buildWorkflowOutputParameters } from '../utils'

export type WorkflowToolFormPayload = {
  icon: Emoji
  label: string
  name: string
  description: string
  parameters: WorkflowToolProviderParameter[]
  outputParameters?: WorkflowToolProviderOutputParameter[] | null
  labels: string[]
  privacy_policy: string
  workflow_app_id?: string
  workflow_tool_id?: string
  tool?: {
    output_schema?: WorkflowToolProviderOutputSchema | null
  }
}

export type UseWorkflowToolFormProps = {
  payload: WorkflowToolFormPayload
  isAdd?: boolean
  onCreate?: (data: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}

type FormState = {
  emoji: Emoji
  label: string
  name: string
  description: string
  parameters: WorkflowToolProviderParameter[]
  labels: string[]
  privacyPolicy: string
}

/**
 * Validate tool name format (alphanumeric and underscores only)
 */
const isNameValid = (name: string): boolean => {
  if (name === '')
    return true
  return /^\w+$/.test(name)
}

/**
 * Custom hook for managing workflow tool form state and logic
 */
export const useWorkflowToolForm = ({
  payload,
  isAdd,
  onCreate,
  onSave,
}: UseWorkflowToolFormProps) => {
  const { t } = useTranslation()

  // Form state
  const [formState, setFormState] = useState<FormState>({
    emoji: payload.icon,
    label: payload.label,
    name: payload.name,
    description: payload.description,
    parameters: payload.parameters,
    labels: payload.labels,
    privacyPolicy: payload.privacy_policy,
  })

  // Computed output parameters (from payload.outputParameters or derived from tool.output_schema)
  const outputParameters = useMemo<WorkflowToolProviderOutputParameter[]>(
    () => buildWorkflowOutputParameters(payload.outputParameters ?? null, payload.tool?.output_schema ?? null),
    [payload.outputParameters, payload.tool?.output_schema],
  )

  // Reserved output parameters (text, files, json)
  const reservedOutputParameters = useMemo<WorkflowToolProviderOutputParameter[]>(() => [
    {
      name: 'text',
      description: t('nodes.tool.outputVars.text', { ns: 'workflow' }),
      type: VarType.string,
      reserved: true,
    },
    {
      name: 'files',
      description: t('nodes.tool.outputVars.files.title', { ns: 'workflow' }),
      type: VarType.arrayFile,
      reserved: true,
    },
    {
      name: 'json',
      description: t('nodes.tool.outputVars.json', { ns: 'workflow' }),
      type: VarType.arrayObject,
      reserved: true,
    },
  ], [t])

  // Check if output parameter name conflicts with reserved names
  const isOutputParameterReserved = useCallback((name: string) => {
    return reservedOutputParameters.some(p => p.name === name)
  }, [reservedOutputParameters])

  // State update handlers
  const setEmoji = useCallback((emoji: Emoji) => {
    setFormState(prev => ({ ...prev, emoji }))
  }, [])

  const setLabel = useCallback((label: string) => {
    setFormState(prev => ({ ...prev, label }))
  }, [])

  const setName = useCallback((name: string) => {
    setFormState(prev => ({ ...prev, name }))
  }, [])

  const setDescription = useCallback((description: string) => {
    setFormState(prev => ({ ...prev, description }))
  }, [])

  const setLabels = useCallback((labels: string[]) => {
    setFormState(prev => ({ ...prev, labels }))
  }, [])

  const setPrivacyPolicy = useCallback((privacyPolicy: string) => {
    setFormState(prev => ({ ...prev, privacyPolicy }))
  }, [])

  // Handle parameter change (description or form/method)
  const handleParameterChange = useCallback((key: 'description' | 'form', value: string, index: number) => {
    setFormState((prev) => {
      const newParameters = produce(prev.parameters, (draft) => {
        if (key === 'description')
          draft[index].description = value
        else
          draft[index].form = value
      })
      return { ...prev, parameters: newParameters }
    })
  }, [])

  // Validate form and show error toast if invalid
  const validateForm = useCallback((): boolean => {
    if (!formState.label) {
      Toast.notify({
        type: 'error',
        message: t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.name', { ns: 'tools' }) }),
      })
      return false
    }

    if (!formState.name) {
      Toast.notify({
        type: 'error',
        message: t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.nameForToolCall', { ns: 'tools' }) }),
      })
      return false
    }

    if (!isNameValid(formState.name)) {
      Toast.notify({
        type: 'error',
        message: t('createTool.nameForToolCall', { ns: 'tools' }) + t('createTool.nameForToolCallTip', { ns: 'tools' }),
      })
      return false
    }

    return true
  }, [formState.label, formState.name, t])

  // Build request params for API
  const buildRequestParams = useCallback((): WorkflowToolProviderRequest => ({
    name: formState.name,
    description: formState.description,
    icon: formState.emoji,
    label: formState.label,
    parameters: formState.parameters.map(item => ({
      name: item.name,
      description: item.description,
      form: item.form,
    })),
    labels: formState.labels,
    privacy_policy: formState.privacyPolicy,
  }), [formState])

  // Submit form
  const onConfirm = useCallback(() => {
    if (!validateForm())
      return

    const requestParams = buildRequestParams()

    if (isAdd) {
      onCreate?.({
        ...requestParams,
        workflow_app_id: payload.workflow_app_id!,
      })
    }
    else {
      onSave?.({
        ...requestParams,
        workflow_tool_id: payload.workflow_tool_id,
      })
    }
  }, [validateForm, buildRequestParams, isAdd, onCreate, onSave, payload.workflow_app_id, payload.workflow_tool_id])

  return {
    // Form state
    emoji: formState.emoji,
    label: formState.label,
    name: formState.name,
    description: formState.description,
    parameters: formState.parameters,
    labels: formState.labels,
    privacyPolicy: formState.privacyPolicy,

    // Computed values
    outputParameters,
    reservedOutputParameters,
    allOutputParameters: [...reservedOutputParameters, ...outputParameters],
    isNameValid: isNameValid(formState.name),

    // Handlers
    setEmoji,
    setLabel,
    setName,
    setDescription,
    setLabels,
    setPrivacyPolicy,
    handleParameterChange,
    isOutputParameterReserved,
    onConfirm,
  }
}
