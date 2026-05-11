'use client'
import type { FC } from 'react'
import type { IInputTypeIconProps } from './input-type-icon'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiDeleteBinLine,
  RiDraggable,
  RiEditLine,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { BracketsX as VarIcon } from '@/app/components/base/icons/src/vender/line/development'
import IconTypeIcon from './input-type-icon'

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
  const { t } = useTranslation()
  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <div className={cn('group relative mb-1 flex h-[34px] w-full items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pr-3 pl-2.5 shadow-xs last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm', isDeleting && 'border-state-destructive-border hover:bg-state-destructive-hover', readonly && 'cursor-not-allowed', className)}>
      <VarIcon className={cn('mr-1 h-4 w-4 shrink-0 text-text-accent', canDrag && 'group-hover:opacity-0')} />
      {canDrag && (
        <RiDraggable className="absolute top-3 left-3 hidden h-3 w-3 cursor-pointer text-text-tertiary group-hover:block" />
      )}
      <div className="flex w-0 grow items-center">
        <div className="truncate" title={`${name} · ${label}`}>
          <span className="system-sm-medium text-text-secondary">{name}</span>
          <span className="px-1 system-xs-regular text-text-quaternary">·</span>
          <span className="system-xs-medium text-text-tertiary">{label}</span>
        </div>
      </div>
      <div className="shrink-0">
        <div className={cn('flex items-center', !readonly && 'group-hover:hidden')}>
          {required && <Badge text="required" />}
          <span className="pr-1 pl-2 system-xs-regular text-text-tertiary">{type}</span>
          <IconTypeIcon type={type as IInputTypeIconProps['type']} className="text-text-tertiary" />
        </div>
        <div className={cn('hidden items-center justify-end rounded-lg', !readonly && 'group-hover:flex')}>
          <button
            type="button"
            aria-label={t('operation.edit', { ns: 'common' })}
            className="mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={onEdit}
          >
            <RiEditLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('operation.delete', { ns: 'common' })}
            className="flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-text-tertiary hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
            onClick={onRemove}
            onMouseOver={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <RiDeleteBinLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default VarItem
