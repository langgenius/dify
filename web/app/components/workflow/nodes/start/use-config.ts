import { useCallback } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import type { StartNodeType } from './types'
import type { InputVar } from '@/app/components/workflow/types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import type { MoreInfo } from '@/app/components/app/configuration/config-var/config-modal'

const useConfig = (id: string, payload: StartNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange } = useWorkflow()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<StartNodeType>(id, payload)

  const [isShowAddVarModal, {
    setTrue: showAddVarModal,
    setFalse: hideAddVarModal,
  }] = useBoolean(false)

  const handleVarListChange = useCallback((newList: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.variables = newList
    })
    setInputs(newInputs)
    if (moreInfo) {
      const changedVar = newList[moreInfo.index]
      handleOutVarRenameChange(id, [id, inputs.variables[moreInfo.index].variable], [id, changedVar.variable])
    }
  }, [inputs, setInputs])

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
  }
}

export default useConfig
