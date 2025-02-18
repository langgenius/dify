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
    <div className={cn('bg-components-panel-on-panel-item-bg border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover group relative  mb-1 flex w-full items-center rounded-lg border-[0.5px] py-2 pl-2.5 pr-3 last-of-type:mb-0 hover:shadow-sm', isDeleting && 'hover:bg-state-destructive-hover border-state-destructive-border', readonly && 'cursor-not-allowed opacity-30')}>
      <VarIcon className='text-text-accent mr-1 h-4 w-4 shrink-0' />
      <div className='grow'>
        <div className='flex h-[18px] items-center'>
          <div className='grow truncate' title={name}>
            <span className='system-sm-medium text-text-secondary'>{name}</span>
            <span className='system-xs-regular text-text-quaternary px-1'>·</span>
            <span className='system-xs-medium text-text-tertiary'>{label}</span>
          </div>
          <div className='flex items-center group-hover:hidden'>
            {required && <Badge text='required' />}
            <span className='system-xs-regular text-text-tertiary pl-2 pr-1'>{type}</span>
            <IconTypeIcon type={type as IInputTypeIconProps['type']} className='text-text-tertiary' />
          </div>
        </div>
      </div>
      {!readonly && (
        <div className='absolute bottom-0 right-0 top-0 hidden w-[124px] items-center justify-end rounded-lg pr-2 group-hover:flex'>
          <div
            className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5'
            onClick={onEdit}
          >
            <RiEditLine className='text-text-tertiary h-4 w-4' />
          </div>
          <div
            className='text-text-tertiary hover:text-text-destructive flex h-6 w-6  cursor-pointer items-center justify-center'
            onClick={onRemove}
            onMouseOver={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <RiDeleteBinLine className='h-4 w-4' />
          </div>
        </div>
      )}
    </div>
  )
}

export default VarItem
