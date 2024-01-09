'use client'
import type { FC } from 'react'
import React from 'react'
import Item from './item'
import type { Collection } from '@/app/components/tools/types'

type Props = {
  list: Collection[]
  onChosen: (Collection: any) => void
}

const ToolNavList: FC<Props> = ({
  list,
  onChosen,
}) => {
  return (
    <div>
      {list.map(item => (
        <Item key={item.name} payload={item} onClick={onChosen}></Item>
      ))}
    </div>
  )
}
export default React.memo(ToolNavList)
