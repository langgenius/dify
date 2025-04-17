'use client'
import ResultPanel from '@/app/components/workflow/run/result-panel'
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
      <ResultPanel
        status='success'
      />
    </div>
  )
}
export default React.memo(LastRun)
