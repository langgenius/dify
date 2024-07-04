import { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { type OutputVar } from '../../code/types'
import { VarType } from '@/app/components/workflow/types'
import {
  useWorkflow,
} from '@/app/components/workflow/hooks'
import useConfirm from '@/app/components/base/confirm/use-confirm'

const i18nPrefix = 'workflow.common.effectVarConfirm'

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
  const { t } = useTranslation()

  const handleVarsChange = useCallback((newVars: OutputVar, changedIndex?: number, newKey?: string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newVars
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
    })
    setInputs(newInputs)
    onOutputKeyOrdersChange([...outputKeyOrders, newKey])
  }, [generateNewKey, inputs, setInputs, onOutputKeyOrdersChange, outputKeyOrders, varKey])

  const [removeVarConfirm, removeVarConfirmHolder] = useConfirm()
  const handleRemoveVariable = useCallback(async (index: number) => {
    const key = outputKeyOrders[index]

    if (isVarUsedInNodes([id, key])) {
      const confirmed = await removeVarConfirm({
        title: t(`${i18nPrefix}.title`),
        content: t(`${i18nPrefix}.content`),
      })
      if (confirmed) {
        removeUsedVarInNodes([id, key])
        const newInputs = produce(inputs, (draft: any) => {
          delete draft[varKey][key]
        })
        setInputs(newInputs)
        onOutputKeyOrdersChange(outputKeyOrders.filter((_, i) => i !== index))
      }
    }
  }, [outputKeyOrders, isVarUsedInNodes, id, inputs, setInputs, onOutputKeyOrdersChange, varKey, removeVarConfirm, removeUsedVarInNodes, t])

  return {
    handleVarsChange,
    handleAddVariable,
    handleRemoveVariable,
    removeVarConfirmHolder,
  }
}

export default useOutputVarList
