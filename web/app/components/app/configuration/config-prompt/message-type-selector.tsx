'use client'
import type { FC } from 'react'
import React from 'react'
import { useBoolean, useClickAway } from 'ahooks'
import cn from '@/utils/classnames'
import { PromptRole } from '@/models/debug'
import { ChevronSelectorVertical } from '@/app/components/base/icons/src/vender/line/arrows'
type Props = {
  value: PromptRole
  onChange: (value: PromptRole) => void
}

const allTypes = [PromptRole.system, PromptRole.user, PromptRole.assistant]
const MessageTypeSelector: FC<Props> = ({
  value,
  onChange,
}) => {
  const [showOption, { setFalse: setHide, toggle: toggleShow }] = useBoolean(false)
  const ref = React.useRef(null)
  useClickAway(() => {
    setHide()
  }, ref)
  return (
    <div className='relative left-[-8px]' ref={ref}>
      <div
        onClick={toggleShow}
        className={cn(showOption && 'bg-indigo-100', 'flex items-center h-7 pl-1.5 pr-1 space-x-0.5 rounded-lg cursor-pointer text-indigo-800')}>
        <div className='text-sm font-semibold uppercase'>{value}</div>
        <ChevronSelectorVertical className='w-3 h-3 ' />
      </div>
      {showOption && (
        <div className='absolute z-10 top-[30px] p-1 border border-gray-200 shadow-lg rounded-lg bg-white'>
          {allTypes.map(type => (
            <div
              key={type}
              onClick={() => {
                setHide()
                onChange(type)
              }}
              className='flex items-center h-9 min-w-[44px] px-3 rounded-lg cursor-pointer text-sm font-medium text-gray-700 uppercase hover:bg-gray-50'
            >{type}</div>
          ))
          }
        </div>
      )
      }
    </div>
  )
}
export default React.memo(MessageTypeSelector)
