'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import type { ThoughtItem } from '../type'
import s from './style.module.css'

export type IThoughtProps = {
  list: ThoughtItem[]
}

const Thought: FC<IThoughtProps> = ({
  list,
}) => {
  const renderItem = (item: ThoughtItem) => (
    <div className='flex space-x-1' key={item.id}>
      <div className='shrink-0'>{item.tool}</div>
      <div>{item.thought}</div>
    </div>
  )
  // const [showMOre]
  return (
    <div className={cn(s.wrap, 'mb-2 px-2 py-0.5 rounded-md')} >
      <div className='flex items-center h-8 space-x-1'>
        <div>Show the process of thinking</div>
      </div>
      <div>
        {list.map(item => renderItem(item))}
      </div>
    </div>
  )
}
export default React.memo(Thought)
