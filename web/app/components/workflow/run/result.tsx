'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useState } from 'react'
import ResultPanel from './result-panel'
import Loading from '@/app/components/base/loading'
import { fetchRunDetail } from '@/service/log'
import type { WorkflowRunDetailResponse } from '@/models/log'
import { useStore as useAppStore } from '@/app/components/app/store'

type ResultProps = {
  runID: string
}

const Result: FC<ResultProps> = ({ runID }) => {
  const { appDetail } = useAppStore()
  const [loading, setLoading] = useState<boolean>(true)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailResponse>()

  const executor = useMemo(() => {
    if (runDetail?.created_by_role === 'account')
      return runDetail.created_by_account?.name || ''
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id || ''
    return 'N/A'
  }, [runDetail])

  useEffect(() => {
    // fetch data
    if (appDetail && runID) {
      setLoading(true)
      fetchRunDetail({
        appID: appDetail?.id,
        runID,
      }).then((res: WorkflowRunDetailResponse) => {
        setLoading(false)
        setRunDetail(res)
      })
    }
  }, [appDetail, runID])

  if (loading || !runDetail) {
    return (
      <div className='flex h-full items-center justify-center bg-white'>
        <Loading />
      </div>
    )
  }

  return (
    <ResultPanel
      inputs={runDetail.inputs}
      outputs={runDetail.outputs}
      status={runDetail.status}
      error={runDetail.error}
      elapsed_time={runDetail.elapsed_time}
      total_tokens={runDetail.total_tokens}
      created_at={runDetail.created_at}
      created_by={executor}
      steps={runDetail.total_steps}
    />
  )
}

export default Result
