import { useCallback } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import type { StartNodeType } from './types'
import { ChangeType } from '@/app/components/workflow/types'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import useConfirm from '@/app/components/base/confirm/use-confirm'

const i18nPrefix = 'workflow.common.effectVarConfirm'

const useConfig = (id: string, payload: StartNodeType) => {
  const { t } = useTranslation()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<StartNodeType>(id, payload)

  const [isShowAddVarModal, {
    setTrue: showAddVarModal,
    setFalse: hideAddVarModal,
  }] = useBoolean(false)

  const [removeVarConfirm, removeVarConfirmHolder] = useConfirm()
  const handleVarListChange = useCallback(async (newList: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => {
    if (moreInfo?.payload?.type === ChangeType.remove) {
      if (isVarUsedInNodes([id, moreInfo?.payload?.payload?.beforeKey || ''])) {
        const confirmed = await removeVarConfirm({
          title: t(`${i18nPrefix}.title`),
          content: t(`${i18nPrefix}.content`),
        })
        if (confirmed) {
          const newInputs = produce(inputs, (draft: any) => {
            draft.variables = newList
          })
          setInputs(newInputs)
          removeUsedVarInNodes([id, moreInfo?.payload?.payload?.beforeKey || ''])
        }
      }
    }
    else if (moreInfo?.payload?.type === ChangeType.changeVarName) {
      const newInputs = produce(inputs, (draft: any) => {
        draft.variables = newList
      })
      setInputs(newInputs)
      const changedVar = newList[moreInfo.index]
      handleOutVarRenameChange(id, [id, inputs.variables[moreInfo.index].variable], [id, changedVar.variable])
    }
  }, [handleOutVarRenameChange, id, inputs, isVarUsedInNodes, setInputs, removeVarConfirm, removeUsedVarInNodes, t])

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
    removeVarConfirmHolder,
  }
}

export default useConfig
