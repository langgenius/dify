import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { produce } from 'immer'
import type { InputVar } from '@/models/pipeline'
import type { SortableItem } from './types'
import type { MoreInfo, ValueSelector } from '@/app/components/workflow/types'
import { ChangeType } from '@/app/components/workflow/types'
import { useWorkflow } from '@/app/components/workflow/hooks'
import { useBoolean } from 'ahooks'

export const useFieldList = (
  initialInputFields: InputVar[],
  onInputFieldsChange: (value: InputVar[]) => void,
  nodeId: string,
) => {
  const [inputFields, setInputFields] = useState<InputVar[]>(initialInputFields)
  const inputFieldsRef = useRef<InputVar[]>(inputFields)
  const [removedVar, setRemovedVar] = useState<ValueSelector>([])
  const [removedIndex, setRemoveIndex] = useState(0)

  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  const [isShowRemoveVarConfirm, {
    setTrue: showRemoveVarConfirm,
    setFalse: hideRemoveVarConfirm,
  }] = useBoolean(false)

  const handleInputFieldsChange = useCallback((newInputFields: InputVar[]) => {
    setInputFields(newInputFields)
    inputFieldsRef.current = newInputFields
    onInputFieldsChange(newInputFields)
  }, [onInputFieldsChange])

  const handleListSortChange = useCallback((list: SortableItem[]) => {
    const newInputFields = list.map((item) => {
      const { id, ...filed } = item
      return filed
    })
    handleInputFieldsChange(newInputFields)
  }, [handleInputFieldsChange])

  const [editingField, setEditingField] = useState<InputVar | undefined>()
  const [showInputFieldEditor, setShowInputFieldEditor] = useState(false)
  const editingFieldIndex = useRef<number>(-1)
  const handleOpenInputFieldEditor = useCallback((id?: string) => {
    const index = inputFieldsRef.current.findIndex(field => field.variable === id)
    editingFieldIndex.current = index
    setEditingField(inputFieldsRef.current[index])
    setShowInputFieldEditor(true)
  }, [])
  const handleCancelInputFieldEditor = useCallback(() => {
    setShowInputFieldEditor(false)
    setEditingField(undefined)
  }, [])

  const handleRemoveField = useCallback((index: number) => {
    const itemToRemove = inputFieldsRef.current[index]
    // Check if the variable is used in other nodes
    if (isVarUsedInNodes([nodeId, itemToRemove.variable || ''])) {
      showRemoveVarConfirm()
      setRemovedVar([nodeId, itemToRemove.variable || ''])
      setRemoveIndex(index as number)
      return
    }
    const newInputFields = inputFieldsRef.current.filter((_, i) => i !== index)
    handleInputFieldsChange(newInputFields)
  }, [handleInputFieldsChange, isVarUsedInNodes, nodeId, showRemoveVarConfirm])

  const onRemoveVarConfirm = useCallback(() => {
    const newInputFields = inputFieldsRef.current.filter((_, i) => i !== removedIndex)
    handleInputFieldsChange(newInputFields)
    removeUsedVarInNodes(removedVar)
    hideRemoveVarConfirm()
  }, [removedIndex, handleInputFieldsChange, removeUsedVarInNodes, removedVar, hideRemoveVarConfirm])

  const handleSubmitField = useCallback((data: InputVar, moreInfo?: MoreInfo) => {
    const newInputFields = produce(inputFieldsRef.current, (draft) => {
      const currentIndex = editingFieldIndex.current
      if (currentIndex === -1) {
        draft.push(data)
        return
      }
      draft[currentIndex] = data
    })
    handleInputFieldsChange(newInputFields)
    // Update variable name in nodes if it has changed
    if (moreInfo?.type === ChangeType.changeVarName)
      handleOutVarRenameChange(nodeId, [nodeId, moreInfo.payload?.beforeKey || ''], [nodeId, moreInfo.payload?.afterKey || ''])
  }, [handleInputFieldsChange, handleOutVarRenameChange, nodeId])

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
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  }
}
