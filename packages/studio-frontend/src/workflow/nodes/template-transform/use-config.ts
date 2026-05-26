import type { Var, Variable } from '../../types'
import type { TemplateTransformNodeType } from '../../nodes/template-transform/types'
import { produce } from 'immer'
import { useCallback, useEffect, useRef } from 'react'
import {
  useNodesReadOnly,
} from '../../hooks'
import useAvailableVarList from '../../nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '../../nodes/_base/hooks/use-node-crud'
import { useStore } from '../../store/index'
import { VarType } from '../../types'
import useVarList from '../../nodes/_base/hooks/use-var-list'

const useConfig = (id: string, payload: TemplateTransformNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type]

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
  }, [defaultConfig])

  const handleCodeChange = useCallback((template: string) => {
    const newInputs = produce(inputsRef.current, (draft: any) => {
      draft.template = template
    })
    setInputs(newInputs)
  }, [setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string, VarType.number, VarType.boolean, VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayBoolean, VarType.arrayObject].includes(varPayload.type)
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
  }
}

export default useConfig
