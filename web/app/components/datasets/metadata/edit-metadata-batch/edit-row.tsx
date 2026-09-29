'use client'
import type { FC } from 'react'
import type { MetadataItemWithEdit } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { UpdateType } from '../types'
import EditedBeacon from './edited-beacon'
import InputCombined from './input-combined'
import InputHasSetMultipleValue from './input-has-set-multiple-value'
import Label from './label'

type Props = Readonly<{
  payload: MetadataItemWithEdit
  onChange: (payload: MetadataItemWithEdit) => void
  onRemove: (id: string) => void
  onReset: (id: string) => void
}>

const EditMetadatabatchItem: FC<Props> = ({ payload, onChange, onRemove, onReset }) => {
  const { t } = useTranslation(['common'])
  const fieldId = useId()
  const actionId = useId()
  const isUpdated = payload.isUpdated
  const isDeleted = payload.updateType === UpdateType.delete
  return (
    <div className="flex h-6 items-center space-x-0.5">
      {isUpdated ? (
        <EditedBeacon fieldId={fieldId} onReset={() => onReset(payload.id)} />
      ) : (
        <div className="size-6 shrink-0" />
      )}
      <Label id={fieldId} text={payload.name} isDeleted={isDeleted} />
      {payload.isMultipleValue ? (
        <InputHasSetMultipleValue
          fieldId={fieldId}
          onClear={() => onChange({ ...payload, value: null, isMultipleValue: false })}
          readOnly={isDeleted}
        />
      ) : (
        <InputCombined
          label={payload.name}
          type={payload.type}
          value={payload.value}
          onChange={(v) => onChange({ ...payload, value: v as string })}
          readOnly={isDeleted}
        />
      )}

      <span id={actionId} className="sr-only">
        {t(($) => $['operation.delete'], { ns: 'common' })}
      </span>
      <IconButton
        aria-labelledby={`${actionId} ${fieldId}`}
        tone="destructive"
        className={cn(isDeleted && 'bg-state-destructive-hover text-text-destructive')}
        onClick={() => onRemove(payload.id)}
      >
        <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
export default React.memo(EditMetadatabatchItem)
