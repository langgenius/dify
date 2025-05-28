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
        className={cn(showOption && 'bg-indigo-100', 'flex h-7 cursor-pointer items-center space-x-0.5 rounded-lg pl-1.5 pr-1 text-indigo-800')}>
        <div className='text-sm font-semibold uppercase'>{value}</div>
        <ChevronSelectorVertical className='h-3 w-3 ' />
      </div>
      {showOption && (
        <div className='absolute top-[30px] z-10 rounded-lg border border-components-panel-border bg-components-panel-bg p-1 shadow-lg'>
          {allTypes.map(type => (
            <div
              key={type}
              onClick={() => {
                setHide()
                onChange(type)
              }}
              className='flex h-9 min-w-[44px] cursor-pointer items-center rounded-lg px-3 text-sm font-medium uppercase text-text-secondary hover:bg-state-base-hover'
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
