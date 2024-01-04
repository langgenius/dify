'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { TypeSquare } from '@/app/components/base/icons/src/vender/solid/editor'

type Props = {
  onChange: (value: string) => void
}

type ItemProps = {
  text: string
  value: string
  Icon: any
  onClick: (value: string) => void
}

const SelectItem: FC<ItemProps> = ({ text, value, Icon, onClick }) => {
  return (
    <div
      className='flex items-center px-3 h-8 rounded-lg hover:bg-gray-50 cursor-pointer'
      onClick={() => onClick(value)}
    >
      <Icon className='w-4 h-4 text-gray-500' />
      <div className='ml-2 text-xs text-gray-600 truncate'>{text}</div>
    </div>
  )
}

const SelectVarType: FC<Props> = ({
  onChange,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 8,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <OperationBtn type='add' className={cn(open && 'bg-gray-200')} />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className='bg-white border border-gray-200 shadow-lg rounded-lg min-w-[192px]'>
          <div className='p-1'>
            <SelectItem Icon={TypeSquare} value='text' text='Short text' onClick={onChange}></SelectItem>
            <SelectItem Icon={TypeSquare} value='text' text='Short text' onClick={onChange}></SelectItem>
            <SelectItem Icon={TypeSquare} value='text' text='Short text' onClick={onChange}></SelectItem>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <SelectItem Icon={TypeSquare} value='text' text='Short text' onClick={onChange}></SelectItem>
          </div>
        </div>
      </PortalToFollowElemContent>

    </PortalToFollowElem>

  )
}
export default React.memo(SelectVarType)
