'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import Item from './item'
import type { Collection } from '@/app/components/tools/types'
type Props = {
  className?: string
  currentIndex: number
  list: Collection[]
  onChosen: (index: number) => void
}

const ToolNavList: FC<Props> = ({
  className,
  currentIndex,
  list,
  onChosen,
}) => {
  return (
    <div className={cn(className)}>
      {list.map((item, index) => (
        <Item isCurrent={index === currentIndex} key={index} payload={item} onClick={() => onChosen(index)}></Item>
      ))}
    </div>
  )
}
export default React.memo(ToolNavList)
