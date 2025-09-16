import useVarList from '../_base/hooks/use-var-list'
import type { ExitNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: ExitNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<ExitNodeType>(id, payload)

  const { handleVarListChange, handleAddVariable } = useVarList<ExitNodeType>({
    inputs,
    setInputs: (newInputs) => {
      setInputs(newInputs)
    },
    varKey: 'outputs',
  })

  return {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
