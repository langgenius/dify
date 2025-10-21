import { useCallback, useRef, useState } from 'react'
import { produce } from 'immer'
import { useBoolean, useDebounceFn } from 'ahooks'
import type {
  CodeNodeType,
  OutputVar,
} from '../../code/types'
import type {
  ValueSelector,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
  VarType,
} from '@/app/components/workflow/types'
import {
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { getDefaultValue } from '@/app/components/workflow/nodes/_base/components/error-handle/utils'
import useInspectVarsCrud from '../../../hooks/use-inspect-vars-crud'

type Params<T> = {
  id: string
  inputs: T
  setInputs: (newInputs: T) => void
  varKey?: string
  outputKeyOrders: string[]
  onOutputKeyOrdersChange: (newOutputKeyOrders: string[]) => void
}
function useOutputVarList<T>({
  id,
  inputs,
  setInputs,
  varKey = 'outputs',
  outputKeyOrders = [],
  onOutputKeyOrdersChange,
}: Params<T>) {
  const {
    renameInspectVarName,
    deleteInspectVar,
    nodesWithInspectVars,
  } = useInspectVarsCrud()

  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  // record the first old name value
  const oldNameRecord = useRef<Record<string, string>>({})

  const {
    run: renameInspectNameWithDebounce,
  } = useDebounceFn(
    (id: string, newName: string) => {
      const oldName = oldNameRecord.current[id]
      renameInspectVarName(id, oldName, newName)
      delete oldNameRecord.current[id]
    },
    { wait: 500 },
  )
  const handleVarsChange = useCallback((newVars: OutputVar, changedIndex?: number, newKey?: string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newVars

      if ((inputs as CodeNodeType).type === BlockEnum.Code && (inputs as CodeNodeType).error_strategy === ErrorHandleTypeEnum.defaultValue && varKey === 'outputs')
        draft.default_value = getDefaultValue(draft as any)
    })
    setInputs(newInputs)

    if (changedIndex !== undefined) {
      const newOutputKeyOrders = produce(outputKeyOrders, (draft) => {
        draft[changedIndex] = newKey!
      })
      onOutputKeyOrdersChange(newOutputKeyOrders)
    }

    if (newKey) {
      handleOutVarRenameChange(id, [id, outputKeyOrders[changedIndex!]], [id, newKey])
      if(!(id in oldNameRecord.current))
        oldNameRecord.current[id] = outputKeyOrders[changedIndex!]
      renameInspectNameWithDebounce(id, newKey)
    }
    else if (changedIndex === undefined) {
      const varId = nodesWithInspectVars.find(node => node.nodeId === id)?.vars.find((varItem) => {
        return varItem.name === Object.keys(newVars)[0]
      })?.id
      if(varId)
        deleteInspectVar(id, varId)
    }
  }, [inputs, setInputs, varKey, outputKeyOrders, onOutputKeyOrdersChange, handleOutVarRenameChange, id, renameInspectNameWithDebounce, nodesWithInspectVars, deleteInspectVar])

  const generateNewKey = useCallback(() => {
    let keyIndex = Object.keys((inputs as any)[varKey]).length + 1
    while (((inputs as any)[varKey])[`var_${keyIndex}`])
      keyIndex++
    return `var_${keyIndex}`
  }, [inputs, varKey])
  const handleAddVariable = useCallback(() => {
    const newKey = generateNewKey()
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = {
        ...draft[varKey],
        [newKey]: {
          type: VarType.string,
          children: null,
        },
      }

      if ((inputs as CodeNodeType).type === BlockEnum.Code && (inputs as CodeNodeType).error_strategy === ErrorHandleTypeEnum.defaultValue && varKey === 'outputs')
        draft.default_value = getDefaultValue(draft as any)
    })
    setInputs(newInputs)
    onOutputKeyOrdersChange([...outputKeyOrders, newKey])
  }, [generateNewKey, inputs, setInputs, onOutputKeyOrdersChange, outputKeyOrders, varKey])

  const [isShowRemoveVarConfirm, {
    setTrue: showRemoveVarConfirm,
    setFalse: hideRemoveVarConfirm,
  }] = useBoolean(false)
  const [removedVar, setRemovedVar] = useState<ValueSelector>([])
  const removeVarInNode = useCallback(() => {
    const varId = nodesWithInspectVars.find(node => node.nodeId === id)?.vars.find((varItem) => {
      return varItem.name === removedVar[1]
    })?.id
    if(varId)
      deleteInspectVar(id, varId)
    removeUsedVarInNodes(removedVar)
    hideRemoveVarConfirm()
  }, [deleteInspectVar, hideRemoveVarConfirm, id, nodesWithInspectVars, removeUsedVarInNodes, removedVar])
  const handleRemoveVariable = useCallback((index: number) => {
    const key = outputKeyOrders[index]

    if (isVarUsedInNodes([id, key])) {
      showRemoveVarConfirm()
      setRemovedVar([id, key])
      return
    }

    const newInputs = produce(inputs, (draft: any) => {
      delete draft[varKey][key]

      if ((inputs as CodeNodeType).type === BlockEnum.Code && (inputs as CodeNodeType).error_strategy === ErrorHandleTypeEnum.defaultValue && varKey === 'outputs')
        draft.default_value = getDefaultValue(draft as any)
    })
    setInputs(newInputs)
    onOutputKeyOrdersChange(outputKeyOrders.filter((_, i) => i !== index))
    const varId = nodesWithInspectVars.find(node => node.nodeId === id)?.vars.find((varItem) => {
      return varItem.name === key
    })?.id
    if(varId)
      deleteInspectVar(id, varId)
  }, [outputKeyOrders, isVarUsedInNodes, id, inputs, setInputs, onOutputKeyOrdersChange, nodesWithInspectVars, deleteInspectVar, showRemoveVarConfirm, varKey])

  return {
    handleVarsChange,
    handleAddVariable,
    handleRemoveVariable,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm: removeVarInNode,
  }
}

export default useOutputVarList
