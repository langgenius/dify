import type { InputVar } from '@/models/pipeline'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import ActionButton from '@/app/components/base/action-button'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import { cn } from '@/utils/classnames'
import FieldListContainer from './field-list-container'
import { useFieldList } from './hooks'

type FieldListProps = {
  nodeId: string
  LabelRightContent: React.ReactNode
  inputFields: InputVar[]
  handleInputFieldsChange: (key: string, value: InputVar[]) => void
  readonly?: boolean
  labelClassName?: string
  allVariableNames: string[]
}

const FieldList = ({
  nodeId,
  LabelRightContent,
  inputFields: initialInputFields,
  handleInputFieldsChange,
  readonly,
  labelClassName,
  allVariableNames,
}: FieldListProps) => {
  const onInputFieldsChange = useCallback((value: InputVar[]) => {
    handleInputFieldsChange(nodeId, value)
  }, [handleInputFieldsChange, nodeId])

  const {
    inputFields,
    handleListSortChange,
    handleRemoveField,
    handleOpenInputFieldEditor,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
  } = useFieldList({
    initialInputFields,
    onInputFieldsChange,
    nodeId,
    allVariableNames,
  })

  return (
    <div className="flex flex-col">
      <div className={cn('flex items-center gap-x-2 px-4', labelClassName)}>
        <div className="grow">
          {LabelRightContent}
        </div>
        <ActionButton
          data-testid="field-list-add-btn"
          onClick={() => handleOpenInputFieldEditor()}
          disabled={readonly}
          className={cn(readonly && 'cursor-not-allowed')}
        >
          <RiAddLine className="h-4 w-4 text-text-tertiary" />
        </ActionButton>
      </div>
      <FieldListContainer
        className="flex flex-col gap-y-1 px-4 pb-1"
        inputFields={inputFields}
        onEditField={handleOpenInputFieldEditor}
        onRemoveField={handleRemoveField}
        onListSortChange={handleListSortChange}
        readonly={readonly}
      />
      <RemoveEffectVarConfirm
        isShow={isShowRemoveVarConfirm}
        onCancel={hideRemoveVarConfirm}
        onConfirm={onRemoveVarConfirm}
      />
    </div>
  )
}

export default React.memo(FieldList)
