import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import {
  arrayNumberPlaceholder,
  arrayObjectPlaceholder,
  arrayStringPlaceholder,
  objectPlaceholder,
} from '@/app/components/workflow/panel/chat-variable-panel/constants'

export const useValueSchema = () => {
  const { t } = useTranslation()
  const getValueFormType = useCallback((form: AnyFormApi) => {
    const {
      type,
      editInJSON,
    } = form.state.values
    console.log(editInJSON, 'editInJSON', type, 'type')
    if (type === ChatVarType.String) {
      return 'textarea-input'
    }
    else if (type === ChatVarType.Number) {
      return 'number-input'
    }
    else if (type === ChatVarType.Object) {
      if (editInJSON)
        return 'json-input'
      else
        return 'object-list'
    }
    else if (type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) {
      if (editInJSON)
        return 'json-input'
      else
        return 'array-list'
    }
    else if (type === ChatVarType.ArrayObject) {
      return 'json-input'
    }
  }, [])
  const getSelfFormProps = useCallback((form: AnyFormApi) => {
    const {
      type,
      editInJSON,
    } = form.state.values
    if (editInJSON || type === ChatVarType.ArrayObject) {
      let minHeight = '120px'
      if (type === ChatVarType.ArrayObject)
        minHeight = '240px'
      let placeholder = objectPlaceholder
      if (type === ChatVarType.ArrayString)
        placeholder = arrayStringPlaceholder
      else if (type === ChatVarType.ArrayNumber)
        placeholder = arrayNumberPlaceholder
      else if (type === ChatVarType.ArrayObject)
        placeholder = arrayObjectPlaceholder
      return {
        editorMinHeight: minHeight,
        placeholder,
      }
    }
    if (type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) {
      if (!editInJSON) {
        return {
          isString: type === ChatVarType.ArrayString,
        }
      }
    }
  }, [])

  return {
    name: 'value',
    label: t('workflow.chatVariable.modal.value'),
    type: getValueFormType,
    placeholder: t('workflow.chatVariable.modal.valuePlaceholder'),
    show_on: [
      {
        variable: 'type',
        value: [ChatVarType.String, ChatVarType.Number, ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayObject],
      },
      {
        variable: 'editInJSON',
        value: [true, false],
      },
    ],
    selfFormProps: getSelfFormProps,
  }
}
