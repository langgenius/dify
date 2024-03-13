import { useCallback } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { TemplateTransformNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'

const useConfig = (id: string, payload: TemplateTransformNodeType) => {
  const { inputs, setInputs } = useNodeCrud<TemplateTransformNodeType>(id, payload)
  const { handleVarListChange, handleAddVariable } = useVarList<TemplateTransformNodeType>({
    inputs,
    setInputs,
  })

  const handleCodeChange = useCallback((template: string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.template = template
    })
    setInputs(newInputs)
  }, [setInputs])

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
    runResult,
  } = useOneStepRun<TemplateTransformNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {},
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
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
    runResult,
  }
}

export default useConfig
