import { useCallback, useEffect, useRef } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { Var, Variable } from '../../types'
import { VarType } from '../../types'
import { useStore } from '../../store'
import type { TemplateTransformNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

const useConfig = (id: string, payload: TemplateTransformNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]

  const { inputs, setInputs: doSetInputs } = useNodeCrud<TemplateTransformNodeType>(id, payload)
  const inputsRef = useRef(inputs)
  const setInputs = useCallback((newPayload: TemplateTransformNodeType) => {
    doSetInputs(newPayload)
    inputsRef.current = newPayload
  }, [doSetInputs])

  const { availableVars } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  const { handleAddVariable: handleAddEmptyVariable } = useVarList<TemplateTransformNodeType>({
    inputs,
    setInputs,
  })

  const handleVarListChange = useCallback((newList: Variable[]) => {
    const newInputs = produce(inputsRef.current, (draft: any) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleAddVariable = useCallback((payload: Variable) => {
    const newInputs = produce(inputsRef.current, (draft: any) => {
      draft.variables.push(payload)
    })
    setInputs(newInputs)
  }, [setInputs])

  // rename var in code
  const handleVarNameChange = useCallback((oldName: string, newName: string) => {
    const newInputs = produce(inputsRef.current, (draft: any) => {
      draft.template = draft.template.replaceAll(`{{ ${oldName} }}`, `{{ ${newName} }}`)
    })
    setInputs(newInputs)
  }, [setInputs])

  useEffect(() => {
    if (inputs.template)
      return

    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      setInputs({
        ...inputs,
        ...defaultConfig,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultConfig])

  const handleCodeChange = useCallback((template: string) => {
    const newInputs = produce(inputsRef.current, (draft: any) => {
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
  }, [setRunInputData])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string, VarType.number, VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject].includes(varPayload.type)
  }, [])

  return {
    readOnly,
    inputs,
    availableVars,
    handleVarListChange,
    handleVarNameChange,
    handleAddVariable,
    handleAddEmptyVariable,
    handleCodeChange,
    filterVar,
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
