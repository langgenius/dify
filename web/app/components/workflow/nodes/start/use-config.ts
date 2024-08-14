import { useCallback, useState } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import type { StartNodeType } from './types'
import { ChangeType } from '@/app/components/workflow/types'
import type { InputVar, MoreInfo, ValueSelector } from '@/app/components/workflow/types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: StartNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<StartNodeType>(id, payload)

  const [isShowAddVarModal, {
    setTrue: showAddVarModal,
    setFalse: hideAddVarModal,
  }] = useBoolean(false)

  const [isShowRemoveVarConfirm, {
    setTrue: showRemoveVarConfirm,
    setFalse: hideRemoveVarConfirm,
  }] = useBoolean(false)
  const [removedVar, setRemovedVar] = useState<ValueSelector>([])
  const [removedIndex, setRemoveIndex] = useState(0)
  const handleVarListChange = useCallback((newList: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => {
    if (moreInfo?.payload?.type === ChangeType.remove) {
      if (isVarUsedInNodes([id, moreInfo?.payload?.payload?.beforeKey || ''])) {
        showRemoveVarConfirm()
        setRemovedVar([id, moreInfo?.payload?.payload?.beforeKey || ''])
        setRemoveIndex(moreInfo?.index as number)
        return
      }
    }

    const newInputs = produce(inputs, (draft: any) => {
      draft.variables = newList
    })
    setInputs(newInputs)
    if (moreInfo?.payload?.type === ChangeType.changeVarName) {
      const changedVar = newList[moreInfo.index]
      handleOutVarRenameChange(id, [id, inputs.variables[moreInfo.index].variable], [id, changedVar.variable])
    }
  }, [handleOutVarRenameChange, id, inputs, isVarUsedInNodes, setInputs, showRemoveVarConfirm])

  const removeVarInNode = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables.splice(removedIndex, 1)
    })
    setInputs(newInputs)
    removeUsedVarInNodes(removedVar)
    hideRemoveVarConfirm()
  }, [hideRemoveVarConfirm, inputs, removeUsedVarInNodes, removedIndex, removedVar, setInputs])

  const handleAddVariable = useCallback((payload: InputVar) => {
    const newInputs = produce(inputs, (draft: StartNodeType) => {
      draft.variables.push(payload)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  return {
    readOnly,
    isChatMode,
    inputs,
    isShowAddVarModal,
    showAddVarModal,
    hideAddVarModal,
    handleVarListChange,
    handleAddVariable,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm: removeVarInNode,
  }
}

export default useConfig
