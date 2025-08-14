import { useTranslation } from 'react-i18next'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { useMemo } from 'react'
import { useTypeSchema } from './use-type-schema'
import { useValueSchema } from './use-value-schema'
import { useEditInJSONSchema } from './use-edit-in-json-schema'

export const useForm = () => {
  const { t } = useTranslation()

  const typeSchema = useTypeSchema()
  const valueSchema = useValueSchema()
  const editInJSONSchema = useEditInJSONSchema()

  const formSchemas = useMemo(() => {
    return [
      {
        name: 'name',
        label: t('workflow.chatVariable.modal.name'),
        type: 'text-input',
        placeholder: t('workflow.chatVariable.modal.namePlaceholder'),
        required: true,
      },
      typeSchema,
      editInJSONSchema,
      valueSchema,
    ]
  }, [t, valueSchema, typeSchema, editInJSONSchema])
  const defaultValues = useMemo(() => {
    return {
      type: ChatVarType.String,
      value: '',
      editInJSON: false,
    }
  }, [])

  return {
    formSchemas,
    defaultValues,
  }
}
