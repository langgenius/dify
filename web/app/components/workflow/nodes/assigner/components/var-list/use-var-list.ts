import { useCallback } from 'react'
import { produce } from 'immer'
import type { AssignerNodeOperation, AssignerNodeType } from '../../types'
import { AssignerNodeInputType, WriteMode } from '../../types'

type Params = {
  id: string
  inputs: AssignerNodeType
  setInputs: (newInputs: AssignerNodeType) => void
}
function useVarList({
  inputs,
  setInputs,
}: Params) {
  const handleVarListChange = useCallback((newList: AssignerNodeOperation[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.items = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.items.push({
        variable_selector: [],
        input_type: AssignerNodeInputType.constant,
        operation: WriteMode.overwrite,
        value: '',
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  return {
    handleVarListChange,
    handleAddVariable,
  }
}

export default useVarList
