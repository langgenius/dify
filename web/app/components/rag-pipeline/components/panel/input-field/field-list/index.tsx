import { useStore } from '@/app/components/workflow/store'
import type { InputVar } from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import FieldItem from './field-item'
import cn from '@/utils/classnames'

type FieldListProps = {
  LabelRightContent: React.ReactNode
  inputFields?: InputVar[]
  readonly?: boolean
  labelClassName?: string
}

const FieldList = ({
  LabelRightContent,
  inputFields,
  readonly,
  labelClassName,
}: FieldListProps) => {
  const showInputFieldEditor = useStore(state => state.showInputFieldEditor)
  const setShowInputFieldEditor = useStore(state => state.setShowInputFieldEditor)

  const isReadonly = readonly || showInputFieldEditor

  const handleAddField = () => {
    setShowInputFieldEditor?.(true)
  }

  return (
    <div className='flex flex-col'>
      <div className={cn('flex items-center gap-x-2 px-4', labelClassName)}>
        <div className='grow'>
          {LabelRightContent}
        </div>
        <button
          type='button'
          className='h-6 px-2 py-1 disabled:cursor-not-allowed'
          onClick={handleAddField}
          disabled={isReadonly}
          aria-disabled={isReadonly}
        >
          <RiAddLine className='h-4 w-4 text-text-tertiary' />
        </button>
      </div>
      <div className='flex flex-col gap-y-1 px-4 pb-2'>
        {inputFields?.map((item, index) => (
          <FieldItem
            key={index}
            readonly={isReadonly}
            payload={item}
            onRemove={() => {
              // Handle remove action
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default FieldList
