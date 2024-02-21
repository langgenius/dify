'use client'
import type { FC } from 'react'
import React from 'react'
import { useBoolean, useClickAway } from 'ahooks'
import cn from 'classnames'
import { ChevronSelectorVertical } from '@/app/components/base/icons/src/vender/line/arrows'
type Item = {
  value: string
  label: string
}
type Props = {
  list: Item[]
  value: string
  onChange: (value: any) => void
  uppercase?: boolean
  popupClassName?: string
}

const TypeSelector: FC<Props> = ({
  list,
  value,
  onChange,
  uppercase,
  popupClassName,
}) => {
  const item = list.find(item => item.value === value)
  const [showOption, { setFalse: setHide, toggle: toggleShow }] = useBoolean(false)
  const ref = React.useRef(null)
  useClickAway(() => {
    setHide()
  }, ref)
  return (
    <div className='relative left-[-8px]' ref={ref}>
      <div
        onClick={toggleShow}
        className={cn(showOption && 'bg-black/5', 'flex items-center h-5 pl-1 pr-0.5 rounded-md text-xs font-semibold text-gray-700 cursor-pointer hover:bg-black/5')}>
        <div className={cn('text-sm font-semibold', uppercase && 'uppercase')}>{item?.label}</div>
        <ChevronSelectorVertical className='w-3 h-3 ' />
      </div>
      {showOption && (
        <div className={cn(popupClassName, 'absolute z-10 top-[24px] w-[120px]  p-1 border border-gray-200 shadow-lg rounded-lg bg-white')}>
          {list.map(item => (
            <div
              key={item.value}
              onClick={() => {
                setHide()
                onChange(item.value)
              }}
              className={cn(uppercase && 'uppercase', 'flex items-center h-[30px] min-w-[44px] px-3 rounded-lg cursor-pointer text-[13px] font-medium text-gray-700 hover:bg-gray-50')}
            >{item.label}</div>
          ))
          }
        </div>
      )
      }
    </div>
  )
}
export default React.memo(TypeSelector)
