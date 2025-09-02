import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { getValue } from '@/app/components/workflow/panel/chat-variable-panel/utils'

export const useEditInJSONSchema = () => {
  const { t } = useTranslation()

  const getEditModeLabel = useCallback((form: AnyFormApi) => {
    const {
      value_type,
      editInJSON,
    } = form.state.values
    const editModeLabelWhenFalse = t('workflow.chatVariable.modal.editInJSON')
    let editModeLabelWhenTrue = t('workflow.chatVariable.modal.oneByOne')
    if (value_type === ChatVarType.Object)
      editModeLabelWhenTrue = t('workflow.chatVariable.modal.editInForm')

    return {
      editModeLabel: editInJSON ? editModeLabelWhenTrue : editModeLabelWhenFalse,
    }
  }, [t])
  const handleEditInJSONChange = useCallback((form: AnyFormApi, v: boolean) => {
    const {
      setFieldValue,
      getFieldValue,
    } = form
    const type = getFieldValue('value_type')
    const value = getFieldValue('value')

    const newValue = getValue(type, !v, value)
    setFieldValue('value', newValue)
  }, [])

  return {
    name: 'editInJSON',
    label: '',
    type: 'edit-mode',
    show_on: [
      {
        variable: 'value_type',
        value: [ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayBoolean],
      },
    ],
    selfFormProps: getEditModeLabel,
    labelClassName: '-mb-9 justify-end',
    onChange: handleEditInJSONChange,
  }
}
