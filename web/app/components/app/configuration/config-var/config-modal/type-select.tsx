'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import classNames from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import type { InputVarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'

export type Item = {
  value: InputVarType
  name: string
}

type Props = {
  value: string | number
  onSelect: (value: Item) => void
  items: Item[]
  popupClassName?: string
  popupInnerClassName?: string
  readonly?: boolean
  hideChecked?: boolean
}
const TypeSelector: FC<Props> = ({
  value,
  onSelect,
  items,
  popupInnerClassName,
  readonly,
}) => {
  const [open, setOpen] = useState(false)
  const selectedItem = value ? items.find(item => item.value === value) : undefined

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => !readonly && setOpen(v => !v)} className='w-full'>
        <div
          className={classNames(`group flex h-9 items-center justify-between rounded-lg border-0 bg-components-input-bg-normal px-2 text-sm hover:bg-state-base-hover-alt ${readonly ? 'cursor-not-allowed' : 'cursor-pointer'}`)}
          title={selectedItem?.name}
        >
          <div className='flex items-center'>
            <InputVarTypeIcon type={selectedItem?.value as InputVarType} className='size-4 shrink-0 text-text-secondary' />
            <span
              className={`
              ml-1.5 text-components-input-text-filled ${!selectedItem?.name && 'text-components-input-text-placeholder'}
            `}
            >
              {selectedItem?.name}
            </span>
          </div>
          <div className='flex items-center space-x-1'>
            <Badge uppercase={false}>{inputVarTypeToVarType(selectedItem?.value as InputVarType)}</Badge>
            <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
          </div>
        </div>

      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[61]'>
        <div
          className={classNames('w-[432px] rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg px-1 py-1 text-base shadow-lg focus:outline-none sm:text-sm', popupInnerClassName)}
        >
          {items.map((item: Item) => (
            <div
              key={item.value}
              className={'flex h-9 cursor-pointer items-center justify-between rounded-lg px-2 text-text-secondary hover:bg-state-base-hover'}
              title={item.name}
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              <div className='flex items-center space-x-2'>
                <InputVarTypeIcon type={item.value} className='size-4 shrink-0 text-text-secondary' />
                <span title={item.name}>{item.name}</span>
              </div>
              <Badge uppercase={false}>{inputVarTypeToVarType(item.value)}</Badge>
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default TypeSelector
