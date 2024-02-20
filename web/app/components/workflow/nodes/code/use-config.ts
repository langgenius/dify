import { useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import type { CodeNodeType } from './types'

const useConfig = (initInputs: CodeNodeType) => {
  const [inputs, setInputs] = useState<CodeNodeType>(initInputs)
  const { handleVarListChange, handleAddVariable } = useVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
