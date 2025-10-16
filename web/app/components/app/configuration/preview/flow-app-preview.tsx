'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  appId: string
}

const FlowAppPreview: FC<Props> = ({
  appId,
}) => {
  return (
    <div>
      {appId}
    </div>
  )
}
export default React.memo(FlowAppPreview)
