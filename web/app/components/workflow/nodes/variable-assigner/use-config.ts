import { useCallback } from 'react'
import produce from 'immer'
import type { VariableAssignerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import type { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)
  const isEnableGroup = !!inputs.advanced_settings?.group_enabled

  // Not Enable Group
  const handleAddVariable = useCallback((value: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    const newInputs = produce(inputs, (draft: VariableAssignerNodeType) => {
      draft.variables.push(value as ValueSelector)
      if (varInfo && varInfo.type !== VarType.any)
        draft.output_type = varInfo.type
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleVarListChange = useCallback((newList: ValueSelector[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
      if (newList.length === 0)
        draft.output_type = VarType.any
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    if (inputs.output_type === VarType.any)
      return true
    return varPayload.type === inputs.output_type
  }, [inputs.output_type])

  return {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    filterVar,
    isEnableGroup,
  }
}

export default useConfig
