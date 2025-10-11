'use client'
import type { FC } from 'react'
import React from 'react'
import { type MetadataItemWithEdit, UpdateType } from '../types'
import Label from './label'
import { RiDeleteBinLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import InputHasSetMultipleValue from './input-has-set-multiple-value'
import InputCombined from './input-combined'
import EditedBeacon from './edited-beacon'

type Props = {
  payload: MetadataItemWithEdit
  onChange: (payload: MetadataItemWithEdit) => void
  onRemove: (id: string) => void
  onReset: (id: string) => void
}

const EditMetadatabatchItem: FC<Props> = ({
  payload,
  onChange,
  onRemove,
  onReset,
}) => {
  const isUpdated = payload.isUpdated
  const isDeleted = payload.updateType === UpdateType.delete
  return (
    <div className='flex h-6 items-center space-x-0.5'>
      {isUpdated ? <EditedBeacon onReset={() => onReset(payload.id)} /> : <div className='size-4 shrink-0' />}
      <Label text={payload.name} isDeleted={isDeleted} />
      {payload.isMultipleValue
        ? <InputHasSetMultipleValue
          onClear={() => onChange({ ...payload, value: null, isMultipleValue: false })}
          readOnly={isDeleted}
        />
        : <InputCombined
          type={payload.type}
          value={payload.value}
          onChange={v => onChange({ ...payload, value: v as string })}
          readOnly={isDeleted}
        />}

      <div
        className={
          cn(
            'cursor-pointer rounded-md p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive',
            isDeleted && 'cursor-default bg-state-destructive-hover  text-text-destructive')
        }
        onClick={() => onRemove(payload.id)}
      >
        <RiDeleteBinLine className='size-4' />
      </div>
    </div>
  )
}
export default React.memo(EditMetadatabatchItem)
