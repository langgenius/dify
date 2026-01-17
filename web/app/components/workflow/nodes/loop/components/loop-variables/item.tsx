import type {
  LoopVariable,
  LoopVariablesComponentShape,
} from '@/app/components/workflow/nodes/loop/types'
import { RiDeleteBinLine } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { ValueType, VarType } from '@/app/components/workflow/types'
import { checkKeys, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import FormItem from './form-item'
import InputModeSelect from './input-mode-selec'
import VariableTypeSelect from './variable-type-select'

type ItemProps = {
  item: LoopVariable
} & LoopVariablesComponentShape
const Item = ({
  nodeId,
  item,
  handleRemoveLoopVariable,
  handleUpdateLoopVariable,
}: ItemProps) => {
  const { t } = useTranslation()

  const checkVariableName = (value: string) => {
    const { isValid, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: t('env.modal.name', { ns: 'workflow' }) }),
      })
      return false
    }
    return true
  }
  const handleUpdateItemLabel = useCallback((e: any) => {
    replaceSpaceWithUnderscoreInVarNameInput(e.target)
    if (!!e.target.value && !checkVariableName(e.target.value))
      return
    handleUpdateLoopVariable(item.id, { label: e.target.value })
  }, [item.id, handleUpdateLoopVariable])

  const getDefaultValue = useCallback((varType: VarType, valueType: ValueType) => {
    if (valueType === ValueType.variable)
      return undefined
    switch (varType) {
      case VarType.boolean:
        return false
      case VarType.arrayBoolean:
        return [false]
      default:
        return undefined
    }
  }, [])

  const handleUpdateItemVarType = useCallback((value: any) => {
    handleUpdateLoopVariable(item.id, { var_type: value, value: getDefaultValue(value, item.value_type) })
  }, [item.id, handleUpdateLoopVariable])

  const handleUpdateItemValueType = useCallback((value: any) => {
    handleUpdateLoopVariable(item.id, { value_type: value, value: getDefaultValue(item.var_type, value) })
  }, [item.id, handleUpdateLoopVariable])

  const handleUpdateItemValue = useCallback((value: any) => {
    handleUpdateLoopVariable(item.id, { value })
  }, [item.id, handleUpdateLoopVariable])

  return (
    <div className="mb-4 flex last-of-type:mb-0">
      <div className="w-0 grow">
        <div className="mb-1 grid grid-cols-3 gap-1">
          <Input
            value={item.label}
            onChange={handleUpdateItemLabel}
            onBlur={e => checkVariableName(e.target.value)}
            autoFocus={!item.label}
            placeholder={t('nodes.loop.variableName', { ns: 'workflow' })}
          />
          <VariableTypeSelect
            value={item.var_type}
            onChange={handleUpdateItemVarType}
          />
          <InputModeSelect
            value={item.value_type}
            onChange={handleUpdateItemValueType}
          />
        </div>
        <div>
          <FormItem
            nodeId={nodeId}
            item={item}
            onChange={handleUpdateItemValue}
          />
        </div>
      </div>
      <ActionButton
        className="shrink-0"
        size="l"
        onClick={() => handleRemoveLoopVariable(item.id)}
      >
        <RiDeleteBinLine className="h-4 w-4 text-text-tertiary" />
      </ActionButton>
    </div>
  )
}

export default Item
