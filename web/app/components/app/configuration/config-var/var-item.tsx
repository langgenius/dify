'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import type { IInputTypeIconProps } from './input-type-icon'
import IconTypeIcon from './input-type-icon'
import { BracketsX as VarIcon } from '@/app/components/base/icons/src/vender/line/development'
import Badge from '@/app/components/base/badge'
import cn from '@/utils/classnames'

type ItemProps = {
  readonly?: boolean
  name: string
  label: string
  required: boolean
  type: string
  onEdit: () => void
  onRemove: () => void
}

const VarItem: FC<ItemProps> = ({
  readonly,
  name,
  label,
  required,
  type,
  onEdit,
  onRemove,
}) => {
  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <div className={cn('group relative flex items-center mb-1 last-of-type:mb-0  pl-2.5 py-2 pr-3 w-full rounded-lg bg-components-panel-on-panel-item-bg border-components-panel-border-subtle border-[0.5px] shadow-xs hover:shadow-sm hover:bg-components-panel-on-panel-item-bg-hover', isDeleting && 'hover:bg-state-destructive-hover border-state-destructive-border', readonly && 'cursor-not-allowed opacity-30')}>
      <VarIcon className='shrink-0 mr-1 w-4 h-4 text-text-accent' />
      <div className='grow'>
        <div className='flex items-center h-[18px]'>
          <div className='grow truncate' title={name}>
            <span className='system-sm-medium text-text-secondary'>{name}</span>
            <span className='px-1 system-xs-regular text-text-quaternary'>·</span>
            <span className='system-xs-medium text-text-tertiary'>{label}</span>
          </div>
          <div className='group-hover:hidden flex items-center'>
            {required && <Badge text='required' />}
            <span className='pl-2 pr-1 system-xs-regular text-text-tertiary'>{type}</span>
            <IconTypeIcon type={type as IInputTypeIconProps['type']} className='text-text-tertiary' />
          </div>
        </div>
      </div>
      {!readonly && (
        <div className='hidden rounded-lg group-hover:flex items-center justify-end absolute right-0 top-0 bottom-0 pr-2 w-[124px]'>
          <div
            className='flex items-center justify-center mr-1 w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
            onClick={onEdit}
          >
            <RiEditLine className='w-4 h-4 text-text-tertiary' />
          </div>
          <div
            className='flex items-center justify-center w-6 h-6  text-text-tertiary cursor-pointer hover:text-text-destructive'
            onClick={onRemove}
            onMouseOver={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <RiDeleteBinLine className='w-4 h-4' />
          </div>
        </div>
      )}
    </div>
  )
}

export default VarItem
