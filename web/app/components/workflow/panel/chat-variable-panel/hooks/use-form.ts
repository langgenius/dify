import { useTranslation } from 'react-i18next'
import type {
  AnyFormApi,
} from '@tanstack/react-form'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { useCallback, useMemo } from 'react'
// import { DEFAULT_OBJECT_VALUE } from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'
// import type { ConversationVariable } from '@/app/components/workflow/types'

const objectPlaceholder = `#  example
#  {
#     "name": "ray",
#     "age": 20
#  }`
const arrayStringPlaceholder = `#  example
#  [
#     "value1",
#     "value2"
#  ]`
const arrayNumberPlaceholder = `#  example
#  [
#     100,
#     200
#  ]`
const arrayObjectPlaceholder = `#  example
#  [
#     {
#       "name": "ray",
#       "age": 20
#     },
#     {
#       "name": "lily",
#       "age": 18
#     }
#  ]`
const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
  ChatVarType.Object,
  ChatVarType.ArrayString,
  ChatVarType.ArrayNumber,
  ChatVarType.ArrayObject,
  'memory',
]

export const useForm = () => {
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
  const handleTypeChange = useCallback((form: AnyFormApi) => {
    const {
      resetField,
    } = form
    resetField('editInJSON')
    resetField('objectListValue')
    resetField('arrayListValue')
    resetField('jsonValue')
  }, [])
  const handleEditInJSONChange = useCallback((form: AnyFormApi) => {
    const {
      resetField,
    } = form
    resetField('objectListValue')
    resetField('arrayListValue')
    resetField('jsonValue')
  }, [])

  const getValueFormType = useCallback((form: AnyFormApi) => {
    const {
      type,
      editInJSON,
    } = form.state.values
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

  const formSchemas = useMemo(() => {
    return [
      {
        name: 'name',
        label: t('workflow.chatVariable.modal.name'),
        type: 'text-input',
        placeholder: t('workflow.chatVariable.modal.namePlaceholder'),
        required: true,
      },
      {
        name: 'type',
        label: t('workflow.chatVariable.modal.type'),
        type: 'select',
        options: typeList.map(type => ({
          label: type,
          value: type,
        })),
        onChange: handleTypeChange,
        required: true,
      },
      {
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
      },
      {
        name: 'value',
        label: t('workflow.chatVariable.modal.value'),
        type: getValueFormType,
        placeholder: t('workflow.chatVariable.modal.valuePlaceholder'),
        show_on: [
          {
            variable: 'type',
            value: [ChatVarType.String, ChatVarType.Number, ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayObject],
          },
        ],
        selfFormProps: getSelfFormProps,
      },
      // {
      //   name: 'objectListValue',
      //   label: t('workflow.chatVariable.modal.value'),
      //   type: 'object-list',
      //   placeholder: t('workflow.chatVariable.modal.valuePlaceholder'),
      //   show_on: [
      //     {
      //       variable: 'type',
      //       value: ChatVarType.Object,
      //     },
      //     {
      //       variable: 'editInJSON',
      //       value: false,
      //     },
      //   ],
      // },
      // {
      //   name: 'arrayListValue',
      //   label: t('workflow.chatVariable.modal.value'),
      //   type: 'array-list',
      //   placeholder: t('workflow.chatVariable.modal.valuePlaceholder'),
      //   show_on: [
      //     {
      //       variable: 'type',
      //       value: [ChatVarType.ArrayString, ChatVarType.ArrayNumber],
      //     },
      //     {
      //       variable: 'editInJSON',
      //       value: false,
      //     },
      //   ],
      //   selfFormProps: getArrayListProps,
      // },
      // {
      //   name: 'jsonValue',
      //   label: t('workflow.chatVariable.modal.value'),
      //   type: 'json-input',
      //   placeholder: arrayObjectPlaceholder,
      //   show_on: getJsonEditorShowOn,
      //   selfFormProps: getJsonEditorProps,
      // },
      // {
      //   name: 'description',
      //   label: t('workflow.chatVariable.modal.description'),
      //   type: 'textarea-input',
      //   placeholder: t('workflow.chatVariable.modal.descriptionPlaceholder'),
      //   show_on: [
      //     {
      //       variable: 'type',
      //       value: [ChatVarType.String, ChatVarType.Number, ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayObject],
      //     },
      //   ],
      // },
      // {
      //   name: 'memoryTemplate',
      //   label: 'Memory template',
      //   type: 'prompt-input',
      // },
      // {
      //   name: 'updateTrigger',
      //   label: 'Update trigger',
      //   type: 'radio',
      //   required: true,
      //   fieldClassName: 'flex items-center justify-between',
      //   options: [
      //     {
      //       label: 'Every N turns',
      //       value: 'every_n_turns',
      //     },
      //     {
      //       label: 'Auto',
      //       value: 'auto',
      //     },
      //   ],
      // },
      // {
      //   name: 'moreSettings',
      //   label: 'More settings',
      //   type: 'collapse',
      // },
      // {
      //   name: 'memoryModel',
      //   label: 'Memory model',
      //   type: 'model-selector',
      //   show_on: [
      //     {
      //       variable: 'moreSettings',
      //       value: true,
      //     },
      //   ],
      // },
    ]
  }, [t, handleTypeChange, handleEditInJSONChange, getValueFormType, getSelfFormProps])
  const defaultValues = useMemo(() => {
    return {
      type: ChatVarType.String,
      value: '',
      // textareaInputValue: '',
      // numberInputValue: 0,
      // objectListValue: [DEFAULT_OBJECT_VALUE],
      // arrayListValue: [undefined],
      editInJSON: false,
    }
  }, [])

  return {
    formSchemas,
    defaultValues,
  }
}
