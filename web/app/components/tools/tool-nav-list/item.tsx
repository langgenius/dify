'use client'
import type { FC } from 'react'
import React from 'react'
import type { Collection } from '@/app/components/tools/types'

type Props = {
  payload: Collection
  onClick: (payload: Collection) => void
}

const Item: FC<Props> = ({
  payload,
  onClick,
}) => {
  return (
    <div onClick={() => onClick(payload)}>
      {payload.name}
    </div>
  )
}
export default React.memo(Item)
