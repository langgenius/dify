import React, { useCallback } from 'react'
import { RiAddLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import InputFieldEditor from '../editor'
import type { InputVar } from '@/models/pipeline'
import ActionButton from '@/app/components/base/action-button'
import { useFieldList } from './hooks'
import FieldListContainer from './field-list-container'

type FieldListProps = {
  nodeId: string
  LabelRightContent: React.ReactNode
  inputFields: InputVar[]
  handleInputFieldsChange: (key: string, value: InputVar[]) => void
  readonly?: boolean
  labelClassName?: string
}

const FieldList = ({
  nodeId,
  LabelRightContent,
  inputFields: initialInputFields,
  handleInputFieldsChange,
  readonly,
  labelClassName,
}: FieldListProps) => {
  const onInputFieldsChange = useCallback((value: InputVar[]) => {
    handleInputFieldsChange(nodeId, value)
  }, [handleInputFieldsChange, nodeId])

  const {
    inputFields,
    handleSubmitField,
    handleListSortChange,
    handleRemoveField,
    handleCancelInputFieldEditor,
    handleOpenInputFieldEditor,
    showInputFieldEditor,
    editingField,
  } = useFieldList(initialInputFields, onInputFieldsChange)

  return (
    <div className='flex flex-col'>
      <div className={cn('flex items-center gap-x-2 px-4', labelClassName)}>
        <div className='grow'>
          {LabelRightContent}
        </div>
        <ActionButton
          onClick={() => handleOpenInputFieldEditor()}
          disabled={readonly}
        >
          <RiAddLine className='h-4 w-4 text-text-tertiary' />
        </ActionButton>
      </div>
      {inputFields.length > 0 && (
        <FieldListContainer
          className='flex flex-col gap-y-1 px-4 pb-2'
          inputFields={inputFields}
          onEditField={handleOpenInputFieldEditor}
          onRemoveField={handleRemoveField}
          onListSortChange={handleListSortChange}
          readonly={readonly}
        />
      )}
      {showInputFieldEditor && (
        <InputFieldEditor
          show={showInputFieldEditor}
          initialData={editingField}
          onSubmit={handleSubmitField}
          onClose={handleCancelInputFieldEditor}
        />
      )}
    </div>
  )
}

export default React.memo(FieldList)
