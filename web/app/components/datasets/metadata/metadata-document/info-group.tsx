'use client'
import type { FC } from 'react'
import React from 'react'
import type { MetadataItemWithValue } from '../types'
import Field from './field'
import InputCombined from '../edit-metadata-batch/input-combined'
import { RiDeleteBinLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type Props = {
  title: string
  titleTooltip?: string
  headerRight?: React.ReactNode
  contentClassName?: string
  list: MetadataItemWithValue[]
  isEdit?: boolean
  onChange?: (item: MetadataItemWithValue) => void
  onDelete?: (item: MetadataItemWithValue) => void
  onAdd?: (item: MetadataItemWithValue) => void
}

const InfoGroup: FC<Props> = ({
  title,
  titleTooltip,
  headerRight,
  contentClassName,
  list,
  isEdit,
  onChange,
  onDelete,
  onAdd,
}) => {
  return (
    <div>
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-1'>
          <div className='system-xs-medium text-text-secondary'>{title}</div>
          {titleTooltip && (
            <Tooltip popupContent={titleTooltip} />
          )}
        </div>
        {headerRight}
        {/* <div className='flex px-1.5 rounded-md hover:bg-components-button-tertiary-bg-hover items-center h-6 space-x-1 cursor-pointer' onClick={() => setIsEdit(true)}>
        </div> */}
      </div>
      <div className={cn('mt-3 space-y-1', contentClassName)}>
        {list.map((item, i) => (
          <Field key={item.id || `${i}`} label={item.name}>
            {isEdit ? (
              <div className='flex items-center space-x-0.5'>
                <InputCombined
                  className='h-6'
                  type={item.type}
                  value={item.value}
                  onChange={value => onChange?.({ ...item, value })}
                />
                <div className='shrink-0 p-1 rounded-md text-text-tertiary  hover:text-text-destructive hover:bg-state-destructive-hover cursor-pointer'>
                  <RiDeleteBinLine className='size-4' />
                </div>
              </div>
            ) : (<div className='py-1 system-xs-regular text-text-secondary'>{item.value}</div>)}
          </Field>
        ))}
      </div>
    </div>
  )
}
export default React.memo(InfoGroup)
