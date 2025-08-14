import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'

export const useEditInJSONSchema = () => {
  const { t } = useTranslation()
  const getEditModeLabel = useCallback((form: AnyFormApi) => {
    const {
      type,
      editInJSON,
    } = form.state.values
    const editModeLabelWhenFalse = t('workflow.chatVariable.modal.editInJSON')
    let editModeLabelWhenTrue = t('workflow.chatVariable.modal.oneByOne')
    if (type === ChatVarType.Object)
      editModeLabelWhenTrue = t('workflow.chatVariable.modal.editInForm')

    return {
      editModeLabel: editInJSON ? editModeLabelWhenTrue : editModeLabelWhenFalse,
    }
  }, [t])
  const handleEditInJSONChange = useCallback((form: AnyFormApi) => {
    const {
      resetField,
    } = form
    resetField('objectListValue')
    resetField('arrayListValue')
    resetField('jsonValue')
  }, [])

  return {
    name: 'editInJSON',
    label: '',
    type: 'edit-mode',
    show_on: [
      {
        variable: 'type',
        value: [ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber],
      },
    ],
    selfFormProps: getEditModeLabel,
    labelClassName: '-mb-9 justify-end',
    onChange: handleEditInJSONChange,
  }
}
