import { useTranslation } from 'react-i18next'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { useMemo } from 'react'
import { useTypeSchema } from './use-type-schema'
import { useValueSchema } from './use-value-schema'
import { useEditInJSONSchema } from './use-edit-in-json-schema'
import {
  useMemoryDefaultValues,
  useMemorySchema,
} from './use-memory-schema'
import type { ConversationVariable, MemoryVariable } from '@/app/components/workflow/types'

export const useForm = (chatVar?: ConversationVariable | MemoryVariable, nodeScopeMemoryVariable?: { nodeId: string }) => {
  const { t } = useTranslation()

  const typeSchema = useTypeSchema()
  const valueSchema = useValueSchema()
  const editInJSONSchema = useEditInJSONSchema()
  const memorySchema = useMemorySchema(nodeScopeMemoryVariable)
  const memoryDefaultValues = useMemoryDefaultValues(nodeScopeMemoryVariable)

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
      {
        name: 'description',
        label: t('workflow.chatVariable.modal.description'),
        type: 'textarea-input',
        placeholder: t('workflow.chatVariable.modal.descriptionPlaceholder'),
        show_on: [
          {
            variable: 'value_type',
            value: [ChatVarType.String, ChatVarType.Number, ChatVarType.Boolean, ChatVarType.Object, ChatVarType.ArrayString, ChatVarType.ArrayNumber, ChatVarType.ArrayBoolean, ChatVarType.ArrayObject],
          },
        ],
      },
      ...memorySchema,
    ]
  }, [t, valueSchema, typeSchema, editInJSONSchema, memorySchema])
  const defaultValues = useMemo(() => {
    if (chatVar)
      return chatVar
    return {
      value_type: ChatVarType.Memory,
      value: '',
      editInJSON: false,
      ...memoryDefaultValues,
    }
  }, [chatVar])

  return {
    formSchemas,
    defaultValues,
  }
}
