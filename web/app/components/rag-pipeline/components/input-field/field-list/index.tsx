import type { InputVar } from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import FieldItem from './field-item'
import cn from '@/utils/classnames'
import { useState } from 'react'
import InputFieldEditor from '../editor'

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
  const [showInputFieldEditor, setShowInputFieldEditor] = useState(false)

  const handleAddField = () => {
    setShowInputFieldEditor(true)
  }

  const handleEditField = (index: number) => {
    setShowInputFieldEditor(true)
  }

  const handleCloseEditor = () => {
    setShowInputFieldEditor(false)
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
          disabled={readonly}
          aria-disabled={readonly}
        >
          <RiAddLine className='h-4 w-4 text-text-tertiary' />
        </button>
      </div>
      <div className='flex flex-col gap-y-1 px-4 pb-2'>
        {inputFields?.map((item, index) => (
          <FieldItem
            key={index}
            readonly={readonly}
            payload={item}
            onRemove={() => {
              // Handle remove action
            }}
            onClickEdit={handleEditField.bind(null, index)}
          />
        ))}
      </div>
      {showInputFieldEditor && (
        <InputFieldEditor
          show={showInputFieldEditor}
          onClose={handleCloseEditor}
        />
      )}
    </div>
  )
}

export default FieldList
