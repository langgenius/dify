'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  className?: string
}

const AppInfo: FC<Props> = ({
  className,
}) => {
  return (
    <div className={className}>
      AppInfo Info
    </div>
  )
}
export default React.memo(AppInfo)
