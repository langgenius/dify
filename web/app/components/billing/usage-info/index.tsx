'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  icon: JSX.Element
  name: string
  tooltip: string
  usage: number
  total: number
  unit: string
}

const UsageInfo: FC<Props> = ({
  icon,
  name,
  tooltip,
  usage,
  total,
  unit,
}) => {
  return (
    <div>
    </div>
  )
}
export default React.memo(UsageInfo)
