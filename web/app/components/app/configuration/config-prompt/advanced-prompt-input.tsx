'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import type { MessageType } from '@/models/debug'

type Props = {
  type: MessageType
  message: string
  canDelete: boolean
}

const AdvancedPromptInput: FC<Props> = ({
  type,
  message,
  canDelete,
}) => {
  return (
    <div className={`${s.gradientBorder}`}>
      <div className='rounded-xl bg-[#EEF4FF]'>
        <div className='flex justify-between items-center'>
          <div>{type}</div>
          <div className='flex items-center space-x-2'>
            {canDelete && (
              <div>delete</div>
            )}
            <div>copy</div>
          </div>
        </div>
        <div>
          {message}
        </div>
        <div>{message.length}</div>
      </div>
    </div>
  )
}
export default React.memo(AdvancedPromptInput)
