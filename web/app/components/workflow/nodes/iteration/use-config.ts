import { useCallback } from 'react'
import produce from 'immer'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { VarType } from '../../types'
import type { ValueSelector, Var } from '../../types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { toNodeOutputVars } from '../_base/components/variable/utils'
import type { IterationNodeType } from './types'

const useConfig = (id: string, payload: IterationNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<IterationNodeType>(id, payload)

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
  }, [])

  const handleInputChange = useCallback((input: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.iterator_selector = input as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // output
  const { getIterationNodeChildren } = useWorkflow()
  const iterationChildrenNodes = getIterationNodeChildren(id)
  const childrenNodeVars = toNodeOutputVars(iterationChildrenNodes, isChatMode)

  const handleOutputVarChange = useCallback((output: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.output_selector = output as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
  }
}

export default useConfig
