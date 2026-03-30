import type { Emoji, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import type { WorkflowToolModalProps } from './types'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { buildWorkflowOutputParameters } from './utils'

export const isWorkflowToolNameValid = (name: string) => {
  if (name === '')
    return true

  return /^\w+$/.test(name)
}

type UseWorkflowToolFormOptions = Pick<WorkflowToolModalProps, 'isAdd' | 'onCreate' | 'onSave' | 'payload'>

export const useWorkflowToolForm = ({
  isAdd,
  onCreate,
  onSave,
  payload,
}: UseWorkflowToolFormOptions) => {
  const { t } = useTranslation()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [label, setLabel] = useState(payload.label)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(payload.description)
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)

  const outputParameters = useMemo(
    () => buildWorkflowOutputParameters(payload.outputParameters, payload.tool?.output_schema),
    [payload.outputParameters, payload.tool?.output_schema],
  )
  const isNameCurrentlyValid = isWorkflowToolNameValid(name)

  const handleParameterChange = useCallback((key: 'description' | 'form', value: string, index: number) => {
    setParameters(current => produce(current, (draft) => {
      const parameter = draft[index]
      if (!parameter)
        return

      if (key === 'description')
        parameter.description = value
      else
        parameter.form = value
    }))
  }, [])

  const handleConfirm = useCallback(() => {
    let errorMessage = ''
    if (!label)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.name', { ns: 'tools' }) })

    if (!name)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.nameForToolCall', { ns: 'tools' }) })

    if (!isWorkflowToolNameValid(name))
      errorMessage = t('createTool.nameForToolCall', { ns: 'tools' }) + t('createTool.nameForToolCallTip', { ns: 'tools' })

    if (errorMessage) {
      toast.error(errorMessage)
      return
    }

    const requestParams: WorkflowToolProviderRequest = {
      name,
      description,
      icon: emoji,
      label,
      parameters: parameters.map(item => ({
        name: item.name,
        description: item.description,
        form: item.form,
      })),
      labels,
      privacy_policy: privacyPolicy,
    }

    if (isAdd) {
      onCreate?.({
        ...requestParams,
        workflow_app_id: payload.workflow_app_id!,
      })
      return
    }

    onSave?.({
      ...requestParams,
      workflow_tool_id: payload.workflow_tool_id!,
    })
  }, [description, emoji, isAdd, label, labels, name, onCreate, onSave, parameters, payload.workflow_app_id, payload.workflow_tool_id, privacyPolicy, t])

  const handlePrimaryAction = useCallback(() => {
    if (isAdd) {
      handleConfirm()
      return
    }

    setShowConfirmModal(true)
  }, [handleConfirm, isAdd])

  return {
    description,
    emoji,
    handleConfirm,
    handleParameterChange,
    handlePrimaryAction,
    isNameCurrentlyValid,
    label,
    labels,
    name,
    outputParameters,
    parameters,
    privacyPolicy,
    setDescription,
    setEmoji,
    setLabel,
    setLabels,
    setName,
    setPrivacyPolicy,
    setShowConfirmModal,
    setShowEmojiPicker,
    showConfirmModal,
    showEmojiPicker,
  }
}
