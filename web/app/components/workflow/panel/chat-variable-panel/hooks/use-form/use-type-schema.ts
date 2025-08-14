import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { DEFAULT_OBJECT_VALUE } from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'
import { typeList } from '@/app/components/workflow/panel/chat-variable-panel/constants'

export const useTypeSchema = () => {
  const { t } = useTranslation()
  const handleTypeChange = useCallback((form: AnyFormApi, v: string) => {
    const {
      setFieldValue,
    } = form
    if (v === ChatVarType.String)
      setFieldValue('value', '')
    else if (v === ChatVarType.Number)
      setFieldValue('value', 0)
    else if (v === ChatVarType.Object)
      setFieldValue('value', [DEFAULT_OBJECT_VALUE])
    else if (v === ChatVarType.ArrayString)
      setFieldValue('value', [undefined])
    else if (v === ChatVarType.ArrayNumber)
      setFieldValue('value', [undefined])
    else if (v === ChatVarType.ArrayObject)
      setFieldValue('value', undefined)
  }, [])

  return {
    name: 'type',
    label: t('workflow.chatVariable.modal.type'),
    type: 'select',
    options: typeList.map(type => ({
      label: type,
      value: type,
    })),
    onChange: handleTypeChange,
    required: true,
  }
}
