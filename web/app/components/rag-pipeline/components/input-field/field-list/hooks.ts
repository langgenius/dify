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
import { useBoolean } from 'ahooks'
import Toast from '@/app/components/base/toast'
import { usePipeline } from '../../../hooks/use-pipeline'

const VARIABLE_PREFIX = 'rag'

export const useFieldList = (
  initialInputFields: InputVar[],
  onInputFieldsChange: (value: InputVar[]) => void,
  nodeId: string,
) => {
  const [inputFields, setInputFields] = useState<InputVar[]>(initialInputFields)
  const inputFieldsRef = useRef<InputVar[]>(inputFields)
  const [removedVar, setRemovedVar] = useState<ValueSelector>([])
  const [removedIndex, setRemoveIndex] = useState(0)

  const { handleInputVarRename, isVarUsedInNodes, removeUsedVarInNodes } = usePipeline()

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
      const { id, chosen, selected, ...filed } = item
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
  const handleCloseInputFieldEditor = useCallback(() => {
    setShowInputFieldEditor(false)
    editingFieldIndex.current = -1
    setEditingField(undefined)
  }, [])

  const handleRemoveField = useCallback((index: number) => {
    const itemToRemove = inputFieldsRef.current[index]
    // Check if the variable is used in other nodes
    if (isVarUsedInNodes([VARIABLE_PREFIX, nodeId, itemToRemove.variable || ''])) {
      showRemoveVarConfirm()
      setRemovedVar([VARIABLE_PREFIX, nodeId, itemToRemove.variable || ''])
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
    const isDuplicate = inputFieldsRef.current.some(field =>
      field.variable === data.variable && field.variable !== editingField?.variable)
    if (isDuplicate) {
      Toast.notify({
        type: 'error',
        message: 'Variable name already exists. Please choose a different name.',
      })
      return
    }
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
      handleInputVarRename(nodeId, [VARIABLE_PREFIX, nodeId, moreInfo.payload?.beforeKey || ''], [VARIABLE_PREFIX, nodeId, moreInfo.payload?.afterKey || ''])
    handleCloseInputFieldEditor()
  }, [editingField?.variable, handleCloseInputFieldEditor, handleInputFieldsChange, handleInputVarRename, nodeId])

  return {
    inputFields,
    handleInputFieldsChange,
    handleListSortChange,
    handleRemoveField,
    handleSubmitField,
    editingField,
    showInputFieldEditor,
    handleOpenInputFieldEditor,
    handleCloseInputFieldEditor,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  }
}
