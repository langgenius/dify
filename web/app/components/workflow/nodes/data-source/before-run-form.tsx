'use client'
import type { FC } from 'react'
import React from 'react'
import type { DataSourceNodeType } from './types'

type Props = {
  payload: DataSourceNodeType
}

const BeforeRunForm: FC<Props> = ({
  payload,
}) => {
  return (
    <div>
      DataSource: {payload.datasource_name}
    </div>
  )
}
export default React.memo(BeforeRunForm)
