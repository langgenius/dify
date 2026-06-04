import type { Var } from '../../types'
import type { EndNodeType } from './types'
import { useCallback } from 'react'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarType } from '../../types'
import useVarList from '../_base/hooks/use-var-list'

const useConfig = (id: string, payload: EndNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<EndNodeType>(id, payload)
  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarType.secret
  }, [])

  const { handleVarListChange, handleAddVariable } = useVarList<EndNodeType>({
    inputs,
    setInputs: (newInputs) => {
      setInputs(newInputs)
    },
    varKey: 'outputs',
    filterVar,
  })

  return {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    filterVar,
  }
}

export default useConfig
