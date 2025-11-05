import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { TYPE_ARRAY_BOOLEAN_DEFAULT_VALUE, TYPE_BOOLEAN_DEFAULT_VALUE, typeList } from '@/app/components/workflow/panel/chat-variable-panel/constants'
import {
  TYPE_ARRAY_NUMBER_DEFAULT_VALUE,
  TYPE_ARRAY_OBJECT_DEFAULT_VALUE,
  TYPE_ARRAY_STRING_DEFAULT_VALUE,
  TYPE_NUMBER_DEFAULT_VALUE,
  TYPE_OBJECT_DEFAULT_VALUE,
  TYPE_STRING_DEFAULT_VALUE,
} from '@/app/components/workflow/panel/chat-variable-panel/constants'

export const useTypeSchema = () => {
  const { t } = useTranslation()
  const handleTypeChange = useCallback((form: AnyFormApi, v: string) => {
    const {
      setFieldValue,
    } = form
    setFieldValue('editInJSON', false)
    if (v === ChatVarType.String)
      setFieldValue('value', TYPE_STRING_DEFAULT_VALUE)
    else if (v === ChatVarType.Number)
      setFieldValue('value', TYPE_NUMBER_DEFAULT_VALUE)
    else if (v === ChatVarType.Boolean)
      setFieldValue('value', TYPE_BOOLEAN_DEFAULT_VALUE)
    else if (v === ChatVarType.Object)
      setFieldValue('value', TYPE_OBJECT_DEFAULT_VALUE)
    else if (v === ChatVarType.ArrayString)
      setFieldValue('value', TYPE_ARRAY_STRING_DEFAULT_VALUE)
    else if (v === ChatVarType.ArrayNumber)
      setFieldValue('value', TYPE_ARRAY_NUMBER_DEFAULT_VALUE)
    else if (v === ChatVarType.ArrayBoolean)
      setFieldValue('value', TYPE_ARRAY_BOOLEAN_DEFAULT_VALUE)
    else if (v === ChatVarType.ArrayObject)
      setFieldValue('value', TYPE_ARRAY_OBJECT_DEFAULT_VALUE)
  }, [])

  return {
    name: 'value_type',
    label: t('workflow.chatVariable.modal.type'),
    type: 'select',
    options: typeList.map(type => ({
      label: type === ChatVarType.Memory ? 'memory' : type,
      value: type,
    })),
    onChange: handleTypeChange,
    required: true,
  }
}
