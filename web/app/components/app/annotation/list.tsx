'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  list: any[]
}

const List: FC<Props> = ({
  list,
}) => {
  return (
    <div>
      {list.map((item, index) => (
        <div key={index}>{item}</div>
      ))}
    </div>
  )
}
export default React.memo(List)
