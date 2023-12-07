'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  appId: string
}

const Annotation: FC<Props> = ({
  appId,
}) => {
  return (
    <div>
      App: {appId}
    </div>
  )
}
export default React.memo(Annotation)
