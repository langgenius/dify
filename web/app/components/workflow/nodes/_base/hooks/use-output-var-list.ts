import { useCallback, useState } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
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
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

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

    if (newKey)
      handleOutVarRenameChange(id, [id, outputKeyOrders[changedIndex!]], [id, newKey])
  }, [inputs, setInputs, handleOutVarRenameChange, id, outputKeyOrders, varKey, onOutputKeyOrdersChange])

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
    removeUsedVarInNodes(removedVar)
    hideRemoveVarConfirm()
  }, [hideRemoveVarConfirm, removeUsedVarInNodes, removedVar])
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
  }, [outputKeyOrders, isVarUsedInNodes, id, inputs, setInputs, onOutputKeyOrdersChange, showRemoveVarConfirm, varKey])

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
