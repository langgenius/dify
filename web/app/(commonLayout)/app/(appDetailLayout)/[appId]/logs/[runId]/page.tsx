import React from 'react'
import Main from '@/app/components/result'

const Result = async ({ params }: { params: { appid: string, runId: string } }) => {
  return (
    <Main runID={params.runId}/>
  )
}

export default Result
