import { useCallback, useEffect, useState } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import useOutputVarList from '../_base/hooks/use-output-var-list'
import { BlockEnum, VarType } from '../../types'
import type { Var } from '../../types'
import { useStore } from '../../store'
import type { CodeDependency, CodeNodeType, OutputVar } from './types'
import { CodeLanguage } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { fetchNodeDefault } from '@/service/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: CodeNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const appId = useAppStore.getState().appDetail?.id

  const [allLanguageDefault, setAllLanguageDefault] = useState<Record<CodeLanguage, CodeNodeType> | null>(null)
  const [allLanguageDependencies, setAllLanguageDependencies] = useState<Record<CodeLanguage, CodeDependency[]> | null>(null)
  useEffect(() => {
    if (appId) {
      (async () => {
        const { config: javaScriptConfig } = await fetchNodeDefault(appId, BlockEnum.Code, { code_language: CodeLanguage.javascript }) as any
        const { config: pythonConfig, available_dependencies: pythonDependencies } = await fetchNodeDefault(appId, BlockEnum.Code, { code_language: CodeLanguage.python3 }) as any
        setAllLanguageDefault({
          [CodeLanguage.javascript]: javaScriptConfig as CodeNodeType,
          [CodeLanguage.python3]: pythonConfig as CodeNodeType,
        } as any)
        setAllLanguageDependencies({
          [CodeLanguage.python3]: pythonDependencies as CodeDependency[],
        } as any)
      })()
    }
  }, [appId])

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]
  const { inputs, setInputs } = useNodeCrud<CodeNodeType>(id, payload)
  const { handleVarListChange, handleAddVariable } = useVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  const handleAddDependency = useCallback((dependency: CodeDependency) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.dependencies)
        draft.dependencies = []
      draft.dependencies.push(dependency)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRemoveDependency = useCallback((index: number) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.dependencies)
        draft.dependencies = []
      draft.dependencies.splice(index, 1)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleChangeDependency = useCallback((index: number, dependency: CodeDependency) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.dependencies)
        draft.dependencies = []
      draft.dependencies[index] = dependency
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const [allowDependencies, setAllowDependencies] = useState<boolean>(false)
  useEffect(() => {
    if (!inputs.code_language)
      return
    if (!allLanguageDependencies)
      return

    const newAllowDependencies = !!allLanguageDependencies[inputs.code_language]
    setAllowDependencies(newAllowDependencies)
  }, [allLanguageDependencies, inputs.code_language])

  const [availableDependencies, setAvailableDependencies] = useState<CodeDependency[]>([])
  useEffect(() => {
    if (!inputs.code_language)
      return
    if (!allLanguageDependencies)
      return

    const newAvailableDependencies = produce(allLanguageDependencies[inputs.code_language], (draft) => {
      const currentLanguage = inputs.code_language
      if (!currentLanguage || !draft || !inputs.dependencies)
        return []
      return draft.filter((dependency) => {
        return !inputs.dependencies?.find(d => d.name === dependency.name)
      })
    })
    setAvailableDependencies(newAvailableDependencies || [])
  }, [allLanguageDependencies, inputs.code_language, inputs.dependencies])

  const [outputKeyOrders, setOutputKeyOrders] = useState<string[]>([])
  const syncOutputKeyOrders = useCallback((outputs: OutputVar) => {
    setOutputKeyOrders(Object.keys(outputs))
  }, [])
  useEffect(() => {
    if (inputs.code) {
      if (inputs.outputs && Object.keys(inputs.outputs).length > 0)
        syncOutputKeyOrders(inputs.outputs)

      return
    }

    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      setInputs({
        ...inputs,
        ...defaultConfig,
      })
      syncOutputKeyOrders(defaultConfig.outputs)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultConfig])

  const handleCodeChange = useCallback((code: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.code = code
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCodeLanguageChange = useCallback((codeLanguage: CodeLanguage) => {
    const currDefaultConfig = allLanguageDefault?.[codeLanguage]

    const newInputs = produce(inputs, (draft) => {
      draft.code_language = codeLanguage
      if (!currDefaultConfig)
        return
      draft.code = currDefaultConfig.code
      draft.variables = currDefaultConfig.variables
      draft.outputs = currDefaultConfig.outputs
    })
    setInputs(newInputs)
  }, [allLanguageDefault, inputs, setInputs])

  const {
    handleVarsChange,
    handleAddVariable: handleAddOutputVariable,
    handleRemoveVariable,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  } = useOutputVarList<CodeNodeType>({
    id,
    inputs,
    setInputs,
    outputKeyOrders,
    onOutputKeyOrdersChange: setOutputKeyOrders,
  })

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string, VarType.number, VarType.secret, VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject].includes(varPayload.type)
  }, [])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<CodeNodeType>({
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

  return {
    readOnly,
    inputs,
    outputKeyOrders,
    handleVarListChange,
    handleAddVariable,
    handleRemoveVariable,
    handleCodeChange,
    handleCodeLanguageChange,
    handleVarsChange,
    filterVar,
    handleAddOutputVariable,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
    runResult,
    availableDependencies,
    allowDependencies,
    handleAddDependency,
    handleRemoveDependency,
    handleChangeDependency,
  }
}

export default useConfig
