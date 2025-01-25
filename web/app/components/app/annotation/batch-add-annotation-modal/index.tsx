'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import CSVUploader from './csv-uploader'
import CSVDownloader from './csv-downloader'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { annotationBatchImport, checkAnnotationBatchImportProgress } from '@/service/annotation'
import { useProviderContext } from '@/context/provider-context'
import AnnotationFull from '@/app/components/billing/annotation-full'

export enum ProcessStatus {
  WAITING = 'waiting',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export type IBatchModalProps = {
  appId: string
  isShow: boolean
  onCancel: () => void
  onAdded: () => void
}

const BatchModal: FC<IBatchModalProps> = ({
  appId,
  isShow,
  onCancel,
  onAdded,
}) => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const [currentCSV, setCurrentCSV] = useState<File>()
  const handleFile = (file?: File) => setCurrentCSV(file)

  useEffect(() => {
    if (!isShow)
      setCurrentCSV(undefined)
  }, [isShow])

  const [importStatus, setImportStatus] = useState<ProcessStatus | string>()
  const notify = Toast.notify
  const checkProcess = async (jobID: string) => {
    try {
      const res = await checkAnnotationBatchImportProgress({ jobID, appId })
      setImportStatus(res.job_status)
      if (res.job_status === ProcessStatus.WAITING || res.job_status === ProcessStatus.PROCESSING)
        setTimeout(() => checkProcess(res.job_id), 2500)
      if (res.job_status === ProcessStatus.ERROR)
        notify({ type: 'error', message: `${t('appAnnotation.batchModal.runError')}` })
      if (res.job_status === ProcessStatus.COMPLETED) {
        notify({ type: 'success', message: `${t('appAnnotation.batchModal.completed')}` })
        onAdded()
        onCancel()
      }
    }
    catch (e: any) {
      notify({ type: 'error', message: `${t('appAnnotation.batchModal.runError')}${'message' in e ? `: ${e.message}` : ''}` })
    }
  }

  const runBatch = async (csv: File) => {
    const formData = new FormData()
    formData.append('file', csv)
    try {
      const res = await annotationBatchImport({
        url: `/apps/${appId}/annotations/batch-import`,
        body: formData,
      })
      setImportStatus(res.job_status)
      checkProcess(res.job_id)
    }
    catch (e: any) {
      notify({ type: 'error', message: `${t('appAnnotation.batchModal.runError')}${'message' in e ? `: ${e.message}` : ''}` })
    }
  }

  const handleSend = () => {
    if (!currentCSV)
      return
    runBatch(currentCSV)
  }

  return (
    <Modal isShow={isShow} onClose={() => { }} className='px-8 py-6 !max-w-[520px] !rounded-xl'>
      <div className='relative pb-1 system-xl-medium text-text-primary'>{t('appAnnotation.batchModal.title')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onCancel}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
      </div>
      <CSVUploader
        file={currentCSV}
        updateFile={handleFile}
      />
      <CSVDownloader />

      {isAnnotationFull && (
        <div className='mt-4'>
          <AnnotationFull />
        </div>
      )}

      <div className='mt-[28px] pt-6 flex justify-end'>
        <Button className='mr-2 text-text-tertiary system-sm-medium' onClick={onCancel}>
          {t('appAnnotation.batchModal.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSend}
          disabled={isAnnotationFull || !currentCSV}
          loading={importStatus === ProcessStatus.PROCESSING || importStatus === ProcessStatus.WAITING}
        >
          {t('appAnnotation.batchModal.run')}
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(BatchModal)
