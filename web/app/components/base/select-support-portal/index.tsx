'use client'
import React, { FC, useState } from 'react'
import PortalToFollowElem from '../portal-to-follow-elem'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline'
import cn from 'classnames'

export interface ISelectProps<T> {
  value: T
  items: { value: T, name: string }[]
  onChange: (value: T) => void
}

const Select: FC<ISelectProps<string | number>> = ({
  value,
  items,
  onChange
}) => {
  const [controlHide, setControlHide] = useState(0)
  const itemsElement = items.map(item => {
    const isSelected = item.value === value
    return (
      <div
        key={item.value}
        className={cn('relative h-9 leading-9 px-10 rounded-lg text-sm text-gray-700 hover:bg-gray-100')}
        onClick={() => {
          onChange(item.value)
          setControlHide(Date.now())
        }}
      >
        {isSelected && (
          <div className='absolute left-4 top-1/2 translate-y-[-50%] flex items-center justify-center w-4 h-4 text-primary-600'>
            <CheckIcon width={16} height={16}></CheckIcon>
          </div>
        )}
        {item.name}
      </div>
    )
  })
  return (
    <div>
      <PortalToFollowElem
        portalElem={(
          <div
            className='p-1 rounded-lg bg-white cursor-pointer'
            style={{
              boxShadow: '0px 10px 15px -3px rgba(0, 0, 0, 0.1), 0px 4px 6px rgba(0, 0, 0, 0.05)'
            }}
          >
            {itemsElement}
          </div>
        )}
        controlHide={controlHide}
      >
        <div className='relative '>
          <div className='flex items-center h-9 px-3 gap-1 cursor-pointer  hover:bg-gray-50'>
            <div className='text-sm text-gray-700'>{items.find(i => i.value === value)?.name}</div>
            <ChevronDownIcon width={16} height={16} />
          </div>
          {/* <div
            className='absolute z-50 left-0 top-9 p-1 w-[112px] rounded-lg bg-white'
            style={{
              boxShadow: '0px 10px 15px -3px rgba(0, 0, 0, 0.1), 0px 4px 6px rgba(0, 0, 0, 0.05)'
            }}
          >
            {itemsElement}
          </div> */}
        </div>
      </PortalToFollowElem>
    </div>

  )
}
export default React.memo(Select)
