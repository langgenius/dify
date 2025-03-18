import { useCallback } from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import InputModeSelect from './input-mode-selec'
import VariableTypeSelect from './variable-type-select'
import FormItem from './form-item'
import ActionButton from '@/app/components/base/action-button'
import Input from '@/app/components/base/input'
import type {
  LoopVariable,
  LoopVariablesComponentShape,
} from '@/app/components/workflow/nodes/loop/types'

type ItemProps = {
  item: LoopVariable
} & LoopVariablesComponentShape
const Item = ({
  nodeId,
  item,
  handleRemoveLoopVariable,
  handleUpdateLoopVariable,
}: ItemProps) => {
  const handleUpdateItemLabel = useCallback((e: any) => {
    handleUpdateLoopVariable(item.id, { label: e.target.value })
  }, [item.id, handleUpdateLoopVariable])

  const handleUpdateItemVarType = useCallback((value: any) => {
    handleUpdateLoopVariable(item.id, { var_type: value, value: undefined })
  }, [item.id, handleUpdateLoopVariable])

  const handleUpdateItemValueType = useCallback((value: any) => {
    handleUpdateLoopVariable(item.id, { value_type: value, value: undefined })
  }, [item.id, handleUpdateLoopVariable])

  return (
    <div className='flex mb-4 last-of-type:mb-0'>
      <div className='grow'>
        <div className='grid grid-cols-3 gap-1 mb-1'>
          <Input
            value={item.label}
            onChange={handleUpdateItemLabel}
            autoFocus
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
          />
        </div>
      </div>
      <ActionButton
        className='shrink-0'
        size='l'
        onClick={() => handleRemoveLoopVariable(item.id)}
      >
        <RiDeleteBinLine className='w-4 h-4 text-text-tertiary' />
      </ActionButton>
    </div>
  )
}

export default Item
