import type { Var, Variable } from '../../types'
import type { CodeNodeType, OutputVar } from './types'
import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  fetchNodeDefault,
  fetchPipelineNodeDefault,
} from '@/service/workflow'
import { useStore } from '../../store'
import { BlockEnum, VarType } from '../../types'
import useOutputVarList from '../_base/hooks/use-output-var-list'
import useVarList from '../_base/hooks/use-var-list'
import { CodeLanguage } from './types'

const useConfig = (id: string, payload: CodeNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const appId = useStore(s => s.appId)
  const pipelineId = useStore(s => s.pipelineId)

  const [allLanguageDefault, setAllLanguageDefault] = useState<Record<CodeLanguage, CodeNodeType> | null>(null)
  useEffect(() => {
    if (appId) {
      (async () => {
        const { config: javaScriptConfig } = await fetchNodeDefault(appId, BlockEnum.Code, { code_language: CodeLanguage.javascript }) as any
        const { config: pythonConfig } = await fetchNodeDefault(appId, BlockEnum.Code, { code_language: CodeLanguage.python3 }) as any
        setAllLanguageDefault({
          [CodeLanguage.javascript]: javaScriptConfig as CodeNodeType,
          [CodeLanguage.python3]: pythonConfig as CodeNodeType,
        } as any)
      })()
    }
  }, [appId])

  useEffect(() => {
    if (pipelineId) {
      (async () => {
        const { config: javaScriptConfig } = await fetchPipelineNodeDefault(pipelineId, BlockEnum.Code, { code_language: CodeLanguage.javascript }) as any
        const { config: pythonConfig } = await fetchPipelineNodeDefault(pipelineId, BlockEnum.Code, { code_language: CodeLanguage.python3 }) as any
        setAllLanguageDefault({
          [CodeLanguage.javascript]: javaScriptConfig as CodeNodeType,
          [CodeLanguage.python3]: pythonConfig as CodeNodeType,
        } as any)
      })()
    }
  }, [pipelineId])

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type]
  const { inputs, setInputs } = useNodeCrud<CodeNodeType>(id, payload)
  const { handleVarListChange, handleAddVariable } = useVarList<CodeNodeType>({
    inputs,
    setInputs,
  })

  const outputKeyOrdersRef = useRef<string[]>(Object.keys(payload.outputs || {}))
  const outputKeyOrders = (() => {
    const outputKeys = inputs.outputs ? Object.keys(inputs.outputs) : []
    if (outputKeys.length === 0) {
      if (outputKeyOrdersRef.current.length > 0)
        outputKeyOrdersRef.current = []
      return [] as string[]
    }

    const nextOutputKeyOrders = outputKeyOrdersRef.current.filter(key => outputKeys.includes(key))
    outputKeys.forEach((key) => {
      if (!nextOutputKeyOrders.includes(key))
        nextOutputKeyOrders.push(key)
    })
    outputKeyOrdersRef.current = nextOutputKeyOrders
    return nextOutputKeyOrders
  })()
  const syncOutputKeyOrders = useCallback((outputs: OutputVar) => {
    outputKeyOrdersRef.current = Object.keys(outputs)
  }, [])
  const handleOutputKeyOrdersChange = useCallback((newOutputKeyOrders: string[]) => {
    outputKeyOrdersRef.current = newOutputKeyOrders
  }, [])
  useEffect(() => {
    const outputKeys = inputs.outputs ? Object.keys(inputs.outputs) : []
    if (outputKeys.length > 0 && outputKeyOrders.length === 0)
      syncOutputKeyOrders(inputs.outputs)

    const hasExistingConfig = Boolean(inputs.code)
      || (inputs.variables?.length ?? 0) > 0
      || outputKeys.length > 0

    if (hasExistingConfig)
      return

    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      setInputs({
        ...inputs,
        ...defaultConfig,
      })
      syncOutputKeyOrders(defaultConfig.outputs)
    }
  }, [defaultConfig, inputs.code, inputs.outputs, inputs.variables, outputKeyOrders.length, setInputs, syncOutputKeyOrders])

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

  const handleSyncFunctionSignature = useCallback(() => {
    const generateSyncSignatureCode = (code: string) => {
      let mainDefRe
      let newMainDef
      if (inputs.code_language === CodeLanguage.javascript) {
        mainDefRe = /function\s+main\b\s*\([\s\S]*?\)/g
        newMainDef = 'function main({{var_list}})'
        let param_list = inputs.variables?.map(item => item.variable).join(', ') || ''
        param_list = param_list ? `{${param_list}}` : ''
        newMainDef = newMainDef.replace('{{var_list}}', param_list)
      }

      else if (inputs.code_language === CodeLanguage.python3) {
        mainDefRe = /def\s+main\b\s*\([\s\S]*?\)/g
        const param_list = []
        for (const item of inputs.variables) {
          let param = item.variable
          let param_type = ''
          switch (item.value_type) {
            case VarType.string:
              param_type = ': str'
              break
            case VarType.number:
              param_type = ': float'
              break
            case VarType.object:
              param_type = ': dict'
              break
            case VarType.array:
              param_type = ': list'
              break
            case VarType.arrayNumber:
              param_type = ': list[float]'
              break
            case VarType.arrayString:
              param_type = ': list[str]'
              break
            case VarType.arrayObject:
              param_type = ': list[dict]'
              break
          }
          param += param_type
          param_list.push(`${param}`)
        }

        newMainDef = `def main(${param_list.join(', ')})`
      }
      else { return code }

      const newCode = code.replace(mainDefRe, newMainDef)
      return newCode
    }

    const newInputs = produce(inputs, (draft) => {
      draft.code = generateSyncSignatureCode(draft.code)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

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
    onOutputKeyOrdersChange: handleOutputKeyOrdersChange,
  })

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string, VarType.number, VarType.boolean, VarType.secret, VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject, VarType.arrayBoolean, VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const handleCodeAndVarsChange = useCallback((code: string, inputVariables: Variable[], outputVariables: OutputVar) => {
    const newInputs = produce(inputs, (draft) => {
      draft.code = code
      draft.variables = inputVariables
      draft.outputs = outputVariables
    })
    setInputs(newInputs)
    syncOutputKeyOrders(outputVariables)
  }, [inputs, setInputs, syncOutputKeyOrders])
  return {
    readOnly,
    inputs,
    outputKeyOrders,
    handleVarListChange,
    handleAddVariable,
    handleRemoveVariable,
    handleSyncFunctionSignature,
    handleCodeChange,
    handleCodeLanguageChange,
    handleVarsChange,
    filterVar,
    handleAddOutputVariable,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
    handleCodeAndVarsChange,
  }
}

export default useConfig
