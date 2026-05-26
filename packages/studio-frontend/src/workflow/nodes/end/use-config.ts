import type { EndNodeType } from '../../nodes/end/types'
import {
  useNodesReadOnly,
} from '../../hooks'
import useNodeCrud from '../../nodes/_base/hooks/use-node-crud'
import useVarList from '../../nodes/_base/hooks/use-var-list'

const useConfig = (id: string, payload: EndNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<EndNodeType>(id, payload)

  const { handleVarListChange, handleAddVariable } = useVarList<EndNodeType>({
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
