'use client'
import type { FC } from 'react'
import React from 'react'
import type { DataSet } from '@/models/datasets'

type Props = {
  payload: DataSet
  onRemove: () => void
}

const DatasetItem: FC<Props> = ({
  payload,
  onRemove,
}) => {
  return (
    <div>
      {payload.name}
    </div>
  )
}
export default React.memo(DatasetItem)
