'use client'
import type { FC } from 'react'
import type { MetadataItemWithEdit } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import InputCombined from './input-combined'
import Label from './label'

type Props = Readonly<{
  className?: string
  payload: MetadataItemWithEdit
  onChange: (value: MetadataItemWithEdit) => void
  onRemove: () => void
}>

const AddRow: FC<Props> = ({ className, payload, onChange, onRemove }) => {
  const { t } = useTranslation(['common'])
  const fieldId = useId()
  const actionId = useId()
  return (
    <div className={cn('flex h-6 items-center space-x-0.5', className)}>
      <Label id={fieldId} text={payload.name} />
      <InputCombined
        label={payload.name}
        type={payload.type}
        value={payload.value}
        onChange={(value) => onChange({ ...payload, value })}
      />
      <span id={actionId} className="sr-only">
        {t(($) => $['operation.remove'], { ns: 'common' })}
      </span>
      <IconButton aria-labelledby={`${actionId} ${fieldId}`} tone="destructive" onClick={onRemove}>
        <span className="i-ri-indeterminate-circle-line size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

export default React.memo(AddRow)
