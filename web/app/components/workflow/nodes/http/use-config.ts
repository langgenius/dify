import { useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import type { HttpNodeType } from './types'

const useConfig = (initInputs: HttpNodeType) => {
  const [inputs, setInputs] = useState<HttpNodeType>(initInputs)

  const { handleVarListChange, handleAddVariable } = useVarList<HttpNodeType>({
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
