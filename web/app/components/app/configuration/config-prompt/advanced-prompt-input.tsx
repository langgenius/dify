'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import MessageTypeSelector from './message-type-selector'
import type { MessageType } from '@/models/debug'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { Clipboard } from '@/app/components/base/icons/src/vender/line/files'

type Props = {
  type: MessageType
  message: string
  onTypeChange: (value: MessageType) => void
  canDelete: boolean
}

const AdvancedPromptInput: FC<Props> = ({
  type,
  message,
  onTypeChange,
  canDelete,
}) => {
  return (
    <div className={`${s.gradientBorder}`}>
      <div className='rounded-xl bg-white'>
        <div className='flex justify-between items-center h-11 pt-2 pr-3 pb-1 pl-4 rounded-tl-xl rounded-tr-xl border-b bg-white'>
          <MessageTypeSelector value={type} onChange={onTypeChange} />
          <div className='flex items-center space-x-1'>
            {canDelete && (
              <Trash03 className='h-6 w-6 p-1 text-gray-500 cursor-pointer' />
            )}
            <Clipboard className='h-6 w-6 p-1 text-gray-500 cursor-pointer' />
          </div>
        </div>
        <div className='px-4 min-h-[102px] max-h-[156px] overflow-y-auto text-sm text-gray-700'>
          {message}
        </div>
        <div className='pl-4 pb-2 flex'>
          <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{message.length}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(AdvancedPromptInput)
