import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { produce } from 'immer'
import type { InputVar } from '@/models/pipeline'
import type { SortableItem } from './types'

export const useFieldList = (
  initialInputFields: InputVar[],
  onInputFieldsChange: (value: InputVar[]) => void,
) => {
  const [inputFields, setInputFields] = useState<InputVar[]>(initialInputFields)
  const inputFieldsRef = useRef<InputVar[]>(inputFields)
  const handleInputFieldsChange = useCallback((newInputFields: InputVar[]) => {
    setInputFields(newInputFields)
    inputFieldsRef.current = newInputFields
    onInputFieldsChange(newInputFields)
  }, [onInputFieldsChange])

  const handleListSortChange = useCallback((list: SortableItem[]) => {
    const newInputFields = list.map((item) => {
      return inputFieldsRef.current.find(field => field.variable === item.name)
    })
    handleInputFieldsChange(newInputFields as InputVar[])
  }, [handleInputFieldsChange])

  const [editingField, setEditingField] = useState<InputVar | undefined>()
  const [showInputFieldEditor, setShowInputFieldEditor] = useState(false)
  const handleOpenInputFieldEditor = useCallback((id?: string) => {
    const fieldToEdit = inputFieldsRef.current.find(field => field.variable === id)
    setEditingField(fieldToEdit)
    setShowInputFieldEditor(true)
  }, [])
  const handleCancelInputFieldEditor = useCallback(() => {
    setShowInputFieldEditor(false)
    setEditingField(undefined)
  }, [])

  const handleRemoveField = useCallback((id: string) => {
    const newInputFields = inputFieldsRef.current.filter(field => field.variable !== id)
    handleInputFieldsChange(newInputFields)
  }, [handleInputFieldsChange])

  const handleSubmitField = useCallback((data: InputVar) => {
    const newInputFields = produce(inputFieldsRef.current, (draft) => {
      const currentIndex = draft.findIndex(field => field.variable === data.variable)
      if (currentIndex === -1) {
        draft.push(data)
        return
      }
      draft[currentIndex] = data
    })
    handleInputFieldsChange(newInputFields)
  }, [handleInputFieldsChange])

  return {
    inputFields,
    handleInputFieldsChange,
    handleListSortChange,
    handleRemoveField,
    handleSubmitField,
    editingField,
    showInputFieldEditor,
    handleOpenInputFieldEditor,
    handleCancelInputFieldEditor,
  }
}
