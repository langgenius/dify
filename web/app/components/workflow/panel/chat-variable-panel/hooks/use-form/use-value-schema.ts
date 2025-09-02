import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import {
  arrayBoolPlaceholder,
  arrayNumberPlaceholder,
  arrayObjectPlaceholder,
  arrayStringPlaceholder,
  objectPlaceholder,
} from '@/app/components/workflow/panel/chat-variable-panel/constants'

export const useValueSchema = () => {
  const { t } = useTranslation()
  const getValueFormType = useCallback((form: AnyFormApi) => {
    const {
      value_type,
      editInJSON,
    } = form.state.values

    if (value_type === ChatVarType.String) {
      return 'textarea-input'
    }
    else if (value_type === ChatVarType.Number) {
      return 'number-input'
    }
    else if (value_type === ChatVarType.Boolean) {
      return 'boolean'
    }
    else if (value_type === ChatVarType.Object) {
      if (editInJSON)
        return 'json-input'
      else
        return 'object-list'
    }
    else if (value_type === ChatVarType.ArrayString || value_type === ChatVarType.ArrayNumber) {
      if (editInJSON)
        return 'json-input'
      else
        return 'array-list'
    }
    else if (value_type === ChatVarType.ArrayBoolean) {
      if (editInJSON)
        return 'json-input'
      else
        return 'boolean-list'
    }
    else if (value_type === ChatVarType.ArrayObject) {
      return 'json-input'
    }
  }, [])
  const getSelfFormProps = useCallback((form: AnyFormApi) => {
    const {
      value_type,
      editInJSON,
    } = form.state.values
    if (editInJSON || value_type === ChatVarType.ArrayObject) {
      let minHeight = '120px'
      if (value_type === ChatVarType.ArrayObject)
        minHeight = '240px'
      let placeholder = objectPlaceholder
      if (value_type === ChatVarType.ArrayString)
        placeholder = arrayStringPlaceholder
      else if (value_type === ChatVarType.ArrayNumber)
        placeholder = arrayNumberPlaceholder
      else if (value_type === ChatVarType.ArrayObject)
        placeholder = arrayObjectPlaceholder
      else if (value_type === ChatVarType.ArrayBoolean)
        placeholder = arrayBoolPlaceholder
      return {
        editorMinHeight: minHeight,
        placeholder,
      }
    }
    if (value_type === ChatVarType.ArrayString || value_type === ChatVarType.ArrayNumber) {
      if (!editInJSON) {
        return {
          isString: value_type === ChatVarType.ArrayString,
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
        variable: 'value_type',
        value: [ChatVarType.String, ChatVarType.Number, ChatVarType.Boolean, ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayBoolean, ChatVarType.ArrayObject],
      },
      {
        variable: 'editInJSON',
        value: [true, false, undefined],
      },
    ],
    selfFormProps: getSelfFormProps,
  }
}
