'use client'
import type { FC } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { useProviderContext } from '@/context/provider-context'
import { annotationBatchImport, checkAnnotationBatchImportProgress } from '@/service/annotation'
import CSVDownloader from './csv-downloader'
import CSVUploader from './csv-uploader'

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
        notify({ type: 'error', message: `${t('batchModal.runError', { ns: 'appAnnotation' })}` })
      if (res.job_status === ProcessStatus.COMPLETED) {
        notify({ type: 'success', message: `${t('batchModal.completed', { ns: 'appAnnotation' })}` })
        onAdded()
        onCancel()
      }
    }
    catch (e: any) {
      notify({ type: 'error', message: `${t('batchModal.runError', { ns: 'appAnnotation' })}${'message' in e ? `: ${e.message}` : ''}` })
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
      notify({ type: 'error', message: `${t('batchModal.runError', { ns: 'appAnnotation' })}${'message' in e ? `: ${e.message}` : ''}` })
    }
  }

  const handleSend = () => {
    if (!currentCSV)
      return
    runBatch(currentCSV)
  }

  return (
    <Modal isShow={isShow} onClose={noop} className="!max-w-[520px] !rounded-xl px-8 py-6">
      <div className="system-xl-medium relative pb-1 text-text-primary">{t('batchModal.title', { ns: 'appAnnotation' })}</div>
      <div className="absolute right-4 top-4 cursor-pointer p-2" onClick={onCancel}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </div>
      <CSVUploader
        file={currentCSV}
        updateFile={handleFile}
      />
      <CSVDownloader />

      {isAnnotationFull && (
        <div className="mt-4">
          <AnnotationFull />
        </div>
      )}

      <div className="mt-[28px] flex justify-end pt-6">
        <Button className="system-sm-medium mr-2 text-text-tertiary" onClick={onCancel}>
          {t('batchModal.cancel', { ns: 'appAnnotation' })}
        </Button>
        <Button
          variant="primary"
          onClick={handleSend}
          disabled={isAnnotationFull || !currentCSV}
          loading={importStatus === ProcessStatus.PROCESSING || importStatus === ProcessStatus.WAITING}
        >
          {t('batchModal.run', { ns: 'appAnnotation' })}
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(BatchModal)
