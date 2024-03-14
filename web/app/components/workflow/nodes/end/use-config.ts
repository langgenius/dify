import useVarList from '../_base/hooks/use-var-list'
import type { EndNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: EndNodeType) => {
  const { inputs, setInputs } = useNodeCrud<EndNodeType>(id, payload)

  const { handleVarListChange, handleAddVariable } = useVarList<EndNodeType>({
    inputs,
    setInputs: (newInputs) => {
      setInputs(newInputs)
    },
    varKey: 'outputs',
  })
  console.log(inputs)

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
