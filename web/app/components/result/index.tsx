'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Run from '@/app/components/workflow/run'

type ResultDetail = {
  runID: string
}

const Result: FC<ResultDetail> = ({ runID }) => {
  const { t } = useTranslation()

  return (
    <div className='h-full grow relative flex flex-col pt-3'>
      <h1 className='shrink-0 px-4 py-1 text-text-primary system-xl-semibold'>{t('appLog.runDetail.workflowTitle')}</h1>
      <Run runID={runID} activeTab="TRACING"/>
    </div>
  )
}

export default Result
