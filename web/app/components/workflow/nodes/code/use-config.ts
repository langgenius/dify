import { useCallback } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import useOutputVarList from '../_base/hooks/use-output-var-list'
import type { CodeLanguage, CodeNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'

const useConfig = (id: string, payload: CodeNodeType) => {
  const { inputs, setInputs } = useNodeCrud<CodeNodeType>(id, payload)
  const { handleVarListChange, handleAddVariable } = useVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  const handleCodeChange = useCallback((code: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.code = code
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCodeLanguageChange = useCallback((codeLanguage: CodeLanguage) => {
    const newInputs = produce(inputs, (draft) => {
      draft.code_language = codeLanguage
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const { handleVarListChange: handleOutputVarListChange, handleAddVariable: handleAddOutputVariable } = useOutputVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
  } = useOneStepRun<CodeNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      name: 'Joel',
      age: '18',
    },
  })
  const varInputs = toVarInputs(inputs.variables)

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [runInputData, setRunInputData])

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleCodeChange,
    handleCodeLanguageChange,
    handleOutputVarListChange,
    handleAddOutputVariable,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
  }
}

export default useConfig
