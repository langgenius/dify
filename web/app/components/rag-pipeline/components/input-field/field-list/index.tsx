import type { InputVar } from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import FieldItem from './field-item'
import cn from '@/utils/classnames'
import { useCallback, useMemo, useState } from 'react'
import InputFieldEditor from '../editor'
import { ReactSortable } from 'react-sortablejs'

type FieldListProps = {
  LabelRightContent: React.ReactNode
  inputFields: InputVar[]
  handleInputFieldsChange: (value: InputVar[]) => void
  readonly?: boolean
  labelClassName?: string
}

const FieldList = ({
  LabelRightContent,
  inputFields,
  handleInputFieldsChange,
  readonly,
  labelClassName,
}: FieldListProps) => {
  const [showInputFieldEditor, setShowInputFieldEditor] = useState(false)

  const optionList = useMemo(() => {
    return inputFields.map((content, index) => {
      return ({
        id: index,
        name: content.variable,
      })
    })
  }, [inputFields])

  const handleListSortChange = useCallback((list: Array<{ id: number, name: string }>) => {
    const newInputFields = list.map((item) => {
      return inputFields.find(field => field.variable === item.name)
    })
    handleInputFieldsChange(newInputFields as InputVar[])
  }, [handleInputFieldsChange, inputFields])

  const handleRemoveField = useCallback((index: number) => {
    const newInputFields = inputFields.filter((_, i) => i !== index)
    handleInputFieldsChange(newInputFields)
  }, [handleInputFieldsChange, inputFields])

  const handleAddField = () => {
    setShowInputFieldEditor(true)
  }

  const handleEditField = useCallback((index: number) => {
    setShowInputFieldEditor(true)
  }, [])

  const handleCloseEditor = useCallback(() => {
    setShowInputFieldEditor(false)
  }, [])

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
      <ReactSortable
        className='flex flex-col gap-y-1 px-4 pb-2'
        list={optionList}
        setList={list => handleListSortChange(list)}
        handle='.handle'
        ghostClass="opacity-50"
        animation={150}
        disabled={readonly}
      >
        {inputFields?.map((item, index) => (
          <FieldItem
            key={index}
            readonly={readonly}
            payload={item}
            onRemove={handleRemoveField.bind(null, index)}
            onClickEdit={handleEditField.bind(null, index)}
          />
        ))}
      </ReactSortable>
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
