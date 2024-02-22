import { useState } from 'react'
import type { StartNodeType } from './types'

const useConfig = (initInputs: StartNodeType) => {
  const [inputs, setInputs] = useState<StartNodeType>(initInputs)

  return {
    inputs,
  }
}

export default useConfig
