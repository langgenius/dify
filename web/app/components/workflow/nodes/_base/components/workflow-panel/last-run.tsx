'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  appId: string
}

const LastRun: FC<Props> = ({
  appId,
}) => {
  return (
    <div>
      last run: {appId}
    </div>
  )
}
export default React.memo(LastRun)
