import { RiDeleteBinLine } from '@remixicon/react'
import InputModeSelect from './input-mode-selec'
import VariableTypeSelect from './variable-type-select'
import FormItem from './form-item'
import ActionButton from '@/app/components/base/action-button'
import Input from '@/app/components/base/input'

type ItemProps = {
  nodeId: string
  item: any
}
const Item = ({
  nodeId,
  item,
}: ItemProps) => {
  return (
    <div className='flex'>
      <div className='grow'>
        <div className='flex items-center'>
          <Input />
          <VariableTypeSelect />
          <InputModeSelect />
        </div>
        <div>
          <FormItem nodeId={nodeId} />
        </div>
      </div>
      <ActionButton
        className='shrink-0'
        size='l'
      >
        <RiDeleteBinLine className='w-4 h-4 text-text-tertiary' />
      </ActionButton>
    </div>
  )
}

export default Item
