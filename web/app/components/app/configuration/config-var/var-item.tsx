'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  RiDeleteBinLine,
  RiDraggable,
  RiEditLine,
} from '@remixicon/react'
import type { IInputTypeIconProps } from './input-type-icon'
import IconTypeIcon from './input-type-icon'
import { BracketsX as VarIcon } from '@/app/components/base/icons/src/vender/line/development'
import Badge from '@/app/components/base/badge'
import cn from '@/utils/classnames'

type ItemProps = {
  className?: string
  readonly?: boolean
  name: string
  label: string
  required: boolean
  type: string
  onEdit: () => void
  onRemove: () => void
  canDrag?: boolean
}

const VarItem: FC<ItemProps> = ({
  className,
  readonly,
  name,
  label,
  required,
  type,
  onEdit,
  onRemove,
  canDrag,
}) => {
  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <div className={cn('group relative mb-1 flex h-[34px] w-full items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2.5 pr-3 shadow-xs last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm', isDeleting && 'border-state-destructive-border hover:bg-state-destructive-hover', readonly && 'cursor-not-allowed opacity-30', className)}>
      <VarIcon className={cn('mr-1 h-4 w-4 shrink-0 text-text-accent', canDrag && 'group-hover:opacity-0')} />
      {canDrag && (
        <RiDraggable className='absolute left-3 top-3 hidden h-3 w-3 cursor-pointer text-text-tertiary group-hover:block' />
      )}
      <div className='flex w-0 grow items-center'>
        <div className='truncate' title={`${name} · ${label}`}>
          <span className='system-sm-medium text-text-secondary'>{name}</span>
          <span className='system-xs-regular px-1 text-text-quaternary'>·</span>
          <span className='system-xs-medium text-text-tertiary'>{label}</span>
        </div>
      </div>
      <div className='shrink-0'>
        <div className={cn('flex items-center', !readonly && 'group-hover:hidden')}>
          {required && <Badge text='required' />}
          <span className='system-xs-regular pl-2 pr-1 text-text-tertiary'>{type}</span>
          <IconTypeIcon type={type as IInputTypeIconProps['type']} className='text-text-tertiary' />
        </div>
        <div className={cn('hidden items-center justify-end rounded-lg', !readonly && 'group-hover:flex')}>
          <div
            className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5'
            onClick={onEdit}
          >
            <RiEditLine className='h-4 w-4 text-text-tertiary' />
          </div>
          <div
            className='flex h-6 w-6 cursor-pointer items-center  justify-center text-text-tertiary hover:text-text-destructive'
            onClick={onRemove}
            onMouseOver={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <RiDeleteBinLine className='h-4 w-4' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default VarItem
