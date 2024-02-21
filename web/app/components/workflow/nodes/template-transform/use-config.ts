import { useCallback, useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import type { TemplateTransformNodeType } from './types'

const useConfig = (initInputs: TemplateTransformNodeType) => {
  const [inputs, setInputs] = useState<TemplateTransformNodeType>(initInputs)
  const { handleVarListChange, handleAddVariable } = useVarList<TemplateTransformNodeType>({
    inputs,
    setInputs,
  })

  const handleCodeChange = useCallback((template: string) => {
    setInputs(prev => ({ ...prev, template }))
  }, [setInputs])

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
  }
}

export default useConfig
