'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useState } from 'react'
import StatusPanel from './status'
import MetaData from './meta'
import Loading from '@/app/components/base/loading'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
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
      return runDetail.created_by_account?.name
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id
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
    <div className='bg-white py-2'>
      <div className='px-4 py-2'>
        <StatusPanel
          status={runDetail.status}
          time={runDetail.elapsed_time}
          tokens={runDetail.total_tokens}
          error={runDetail.error}
        />
      </div>
      <div className='px-4 py-2 flex flex-col gap-2'>
        {/* ###TODO### value */}
        <CodeEditor
          readOnly
          title={<div>INPUT</div>}
          language={CodeLanguage.json}
          value={''}
          onChange={() => {}}
        />
        {/* ###TODO### value */}
        <CodeEditor
          readOnly
          title={<div>OUTPUT</div>}
          language={CodeLanguage.json}
          value={''}
          onChange={() => {}}
        />
      </div>
      <div className='px-4 py-2'>
        <div className='h-[0.5px] bg-black opacity-5'/>
      </div>
      <div className='px-4 py-2'>
        <MetaData
          status={runDetail.status}
          executor={executor}
          startTime={runDetail.created_at}
          time={runDetail.elapsed_time}
          tokens={runDetail.total_tokens}
          steps={runDetail.total_steps}
        />
      </div>
    </div>
  )
}

export default Result
