import { useCallback, useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import useOutputVarList from '../_base/hooks/use-output-var-list'
import type { CodeLanguage, CodeNodeType } from './types'

const useConfig = (initInputs: CodeNodeType) => {
  const [inputs, setInputs] = useState<CodeNodeType>(initInputs)
  const { handleVarListChange, handleAddVariable } = useVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  const handleCodeChange = useCallback((code: string) => {
    setInputs(prev => ({ ...prev, code }))
  }, [setInputs])

  const handleCodeLanguageChange = useCallback((codeLanguage: CodeLanguage) => {
    setInputs(prev => ({ ...prev, code_language: codeLanguage }))
  }, [setInputs])

  const { handleVarListChange: handleOutputVarListChange, handleAddVariable: handleAddOutputVariable } = useOutputVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
    handleCodeLanguageChange,
    handleOutputVarListChange,
    handleAddOutputVariable,
  }
}

export default useConfig
