import type { InputVar } from '@/models/pipeline'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
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
  const { t } = useTranslation()
  const onInputFieldsChange = useCallback(
    (value: InputVar[]) => {
      handleInputFieldsChange(nodeId, value)
    },
    [handleInputFieldsChange, nodeId],
  )

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
        <div className="grow">{LabelRightContent}</div>
        <IconButton
          aria-label={t(($) => $['operation.add'], { ns: 'common' })}
          onClick={() => handleOpenInputFieldEditor()}
          disabled={readonly}
        >
          <RiAddLine className="size-4 text-text-tertiary" aria-hidden="true" />
        </IconButton>
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
