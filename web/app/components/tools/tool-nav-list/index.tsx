'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import Item from './item'
import type { Collection } from '@/app/components/tools/types'
type Props = {
  className?: string
  currentName: string
  list: Collection[]
  onChosen: (Collection: any) => void
}

const ToolNavList: FC<Props> = ({
  className,
  currentName,
  list,
  onChosen,
}) => {
  return (
    <div className={cn(className)}>
      {list.map(item => (
        <Item isCurrent={item.name === currentName} key={item.name} payload={item} onClick={onChosen}></Item>
      ))}
    </div>
  )
}
export default React.memo(ToolNavList)
