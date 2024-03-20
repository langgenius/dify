import { useCallback, useState } from 'react'
import produce from 'immer'
import useVarList from './components/var-list/use-var-list'
import type { VariableAssignerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)

  const handleOutputTypeChange = useCallback((outputType: string) => {
    const newInputs = produce(inputs, (draft: VariableAssignerNodeType) => {
      draft.output_type = outputType as VarType
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const { handleVarListChange, handleAddVariable } = useVarList({
    id,
    inputs,
    setInputs,
  })

  const { variables } = inputs
  const [currVarIndex, setCurrVarIndex] = useState(-1)
  const currVar = variables[currVarIndex]
  const handleOnVarOpen = useCallback((index: number) => {
    setCurrVarIndex(index)
  }, [])
  const filterVar = useCallback((varPayload: Var, valueSelector: ValueSelector) => {
    const type = varPayload.type
    if ((inputs.output_type !== VarType.array && type !== inputs.output_type) || (
      inputs.output_type === VarType.array && ![VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(type)
    ))
      return false

    // can not choose the same node
    if (!currVar)
      return true

    const selectNodeId = valueSelector[0]

    if (selectNodeId !== currVar[0] && variables.find(v => v[0] === selectNodeId))
      return false

    return true
  }, [currVar, inputs.output_type, variables])
  return {
    readOnly,
    inputs,
    handleOutputTypeChange,
    handleVarListChange,
    handleAddVariable,
    handleOnVarOpen,
    filterVar,
  }
}

export default useConfig
