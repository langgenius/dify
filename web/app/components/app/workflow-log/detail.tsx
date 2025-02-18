'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Run from '@/app/components/workflow/run'

interface ILogDetail {
  runID: string
  onClose: () => void
}

const DetailPanel: FC<ILogDetail> = ({ runID, onClose }) => {
  const { t } = useTranslation()

  return (
    <div className='relative flex grow flex-col pt-3'>
      <span className='absolute right-3 top-4 z-20 cursor-pointer p-1' onClick={onClose}>
        <RiCloseLine className='text-text-tertiary h-4 w-4' />
      </span>
      <h1 className='text-text-primary system-xl-semibold shrink-0 px-4 py-1'>{t('appLog.runDetail.workflowTitle')}</h1>
      <Run runID={runID}/>
    </div>
  )
}

export default DetailPanel
