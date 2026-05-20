import type { ObjectValueItem, ToastPayload } from './variable-modal.helpers'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { useMemo, useState } from 'react'
import { v4 as uuid4 } from 'uuid'
import { DEFAULT_OBJECT_VALUE } from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import {
  buildObjectValueItems,
  formatChatVariableValue,
  formatObjectValueFromList,
  getEditorMinHeight,
  getPlaceholderByType,
  getTypeChangeState,
  parseEditorContent,
  validateVariableName,
} from './variable-modal.helpers'

type UseVariableModalStateOptions = {
  chatVar?: ConversationVariable
  conversationVariables: ConversationVariable[]
  notify: (props: ToastPayload) => void
  onClose: () => void
  onSave: (chatVar: ConversationVariable) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

type VariableModalState = {
  description: string
  editInJSON: boolean
  editorContent?: string
  name: string
  objectValue: ObjectValueItem[]
  type: ChatVarType
  value: unknown
}

const buildObjectValueListFromRecord = (record: Record<string, string | number>) => {
  return Object.keys(record).map(key => ({
    key,
    type: typeof record[key] === 'string' ? ChatVarType.String : ChatVarType.Number,
    value: record[key],
  }))
}

const buildInitialState = (chatVar?: ConversationVariable): VariableModalState => {
  if (!chatVar) {
    return {
      description: '',
      editInJSON: false,
      editorContent: undefined,
      name: '',
      objectValue: [DEFAULT_OBJECT_VALUE],
      type: ChatVarType.String,
      value: undefined,
    }
  }

  return {
    description: chatVar.description,
    editInJSON: chatVar.value_type === ChatVarType.ArrayObject,
    editorContent: chatVar.value_type === ChatVarType.ArrayObject ? JSON.stringify(chatVar.value) : undefined,
    name: chatVar.name,
    objectValue: buildObjectValueItems(chatVar),
    type: chatVar.value_type,
    value: chatVar.value,
  }
}

export const useVariableModalState = ({
  chatVar,
  conversationVariables,
  notify,
  onClose,
  onSave,
  t,
}: UseVariableModalStateOptions) => {
  const [state, setState] = useState<VariableModalState>(() => buildInitialState(chatVar))

  const editorMinHeight = useMemo(() => getEditorMinHeight(state.type), [state.type])
  const placeholder = useMemo(() => getPlaceholderByType(state.type), [state.type])

  const handleVarNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, name: e.target.value || '' }))
  }

  const handleTypeChange = (nextType: ChatVarType) => {
    const nextState = getTypeChangeState(nextType)
    setState(prev => ({
      ...prev,
      editInJSON: nextState.editInJSON,
      editorContent: nextState.editorContent,
      objectValue: nextState.objectValue ?? prev.objectValue,
      type: nextType,
      value: nextState.value,
    }))
  }

  const handleStringOrNumberChange = (nextValue: Array<string | number | undefined>) => {
    setState(prev => ({ ...prev, value: nextValue[0] }))
  }

  const handleEditorChange = (nextEditInJSON: boolean) => {
    setState((prev) => {
      const nextState: VariableModalState = {
        ...prev,
        editInJSON: nextEditInJSON,
      }

      if (prev.type === ChatVarType.Object) {
        if (nextEditInJSON) {
          const nextValue = prev.objectValue.some(item => item.key) ? formatObjectValueFromList(prev.objectValue) : undefined
          nextState.value = nextValue
          nextState.editorContent = JSON.stringify(nextValue)
          return nextState
        }

        if (!prev.editorContent) {
          nextState.value = undefined
          nextState.objectValue = [DEFAULT_OBJECT_VALUE]
          return nextState
        }

        try {
          const nextValue = JSON.parse(prev.editorContent) as Record<string, string | number>
          nextState.value = nextValue
          nextState.objectValue = buildObjectValueListFromRecord(nextValue)
        }
        catch {
          // ignore JSON.parse errors
        }
        return nextState
      }

      if (prev.type === ChatVarType.ArrayString || prev.type === ChatVarType.ArrayNumber) {
        if (nextEditInJSON) {
          const compactValues = Array.isArray(prev.value)
            ? prev.value.filter(item => item !== null && item !== undefined && item !== '')
            : []
          const nextValue = compactValues.length
            ? compactValues
            : undefined
          nextState.value = nextValue
          if (!prev.editorContent)
            nextState.editorContent = JSON.stringify(nextValue)
          return nextState
        }

        nextState.value = Array.isArray(prev.value) && prev.value.length ? prev.value : [undefined]
        return nextState
      }

      if (prev.type === ChatVarType.ArrayBoolean && Array.isArray(prev.value) && nextEditInJSON)
        nextState.editorContent = JSON.stringify(prev.value.map(item => item ? 'True' : 'False'))

      return nextState
    })
  }

  const handleEditorValueChange = (content: string) => {
    setState((prev) => {
      const nextState: VariableModalState = {
        ...prev,
        editorContent: content,
      }

      if (!content) {
        nextState.value = undefined
        return nextState
      }

      try {
        nextState.value = parseEditorContent({ content, type: prev.type })
      }
      catch {
        // ignore JSON.parse errors
      }

      return nextState
    })
  }

  const handleSave = () => {
    if (!validateVariableName({ name: state.name, notify, t }))
      return

    if (!chatVar && conversationVariables.some(item => item.name === state.name)) {
      notify({
        type: 'error',
        message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: t('chatVariable.modal.name', { ns: 'workflow' }) }),
      })
      return
    }

    if (state.type === ChatVarType.Object && state.objectValue.some(item => !item.key && item.value !== undefined && item.value !== '')) {
      notify({ type: 'error', message: t('chatVariable.modal.objectKeyRequired', { ns: 'workflow' }) })
      return
    }

    onSave({
      description: state.description,
      id: chatVar ? chatVar.id : uuid4(),
      name: state.name,
      value: formatChatVariableValue({
        editInJSON: state.editInJSON,
        objectValue: state.objectValue,
        type: state.type,
        value: state.value,
      }),
      value_type: state.type,
    })
    onClose()
  }

  return {
    description: state.description,
    editInJSON: state.editInJSON,
    editorContent: state.editorContent,
    editorMinHeight,
    handleEditorChange,
    handleEditorValueChange,
    handleSave,
    handleStringOrNumberChange,
    handleTypeChange,
    handleVarNameChange,
    name: state.name,
    objectValue: state.objectValue,
    placeholder,
    setDescription: (description: string) => setState(prev => ({ ...prev, description })),
    setObjectValue: (objectValue: ObjectValueItem[]) => setState(prev => ({ ...prev, objectValue })),
    setValue: (value: unknown) => setState(prev => ({ ...prev, value })),
    type: state.type,
    value: state.value,
  }
}
