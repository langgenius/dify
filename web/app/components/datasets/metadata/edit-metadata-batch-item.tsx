'use client'
import type { FC } from 'react'
import React from 'react'
import type { MetadataItemWithEdit } from './types'
import Input from '../create/website/base/input'

type Props = {
  payload: MetadataItemWithEdit
  onChange: (payload: MetadataItemWithEdit) => void
  onRemove: (id: string) => void
}

const labelClassName = 'w-[136px] system-xs-medium text-text-tertiary'

export const AddedMetadataItem: FC<Props> = ({
  payload,
  onChange,
}) => {
  return (
    <div className='flex'>
      <div className={labelClassName}>{payload.name}</div>
      <Input
        value={payload.value}
        onChange={v => onChange({ ...payload, value: v as string })
        } />
    </div>
  )
}

const EditMetadatabatchItem: FC<Props> = ({
  payload,
  onChange,
  onRemove,
}) => {
  return (
    <div className='flex'>
      <div className={labelClassName}>{payload.name}</div>
      <Input
        value={payload.value}
        onChange={v => onChange({ ...payload, value: v as string })
        } />
    </div>
  )
}
export default React.memo(EditMetadatabatchItem)
