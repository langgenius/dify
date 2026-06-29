'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [currentFile, setCurrentFile] = useState<File>()
  const handleFile = (file?: File) => setCurrentFile(file)

  useEffect(() => {
    if (!isShow)
      setCurrentFile(undefined)
  }, [isShow])

  const [importStatus, setImportStatus] = useState<ProcessStatus | string>()
  const getRunErrorMessage = (message?: string) => {
    const runError = t('batchModal.runError', { ns: 'appAnnotation' })
    return message ? `${runError}: ${message}` : `${runError}`
  }
  const checkProcess = async (jobID: string) => {
    try {
      const res = await checkAnnotationBatchImportProgress({ jobID, appId })
      setImportStatus(res.job_status)
      if (res.job_status === ProcessStatus.WAITING || res.job_status === ProcessStatus.PROCESSING)
        setTimeout(() => checkProcess(res.job_id), 2500)
      if (res.job_status === ProcessStatus.ERROR)
        toast.error(getRunErrorMessage(res.error_msg))
      if (res.job_status === ProcessStatus.COMPLETED) {
        toast.success(`${t('batchModal.completed', { ns: 'appAnnotation' })}`)
        onAdded()
        onCancel()
      }
    }
    catch (e: unknown) {
      toast.error(getRunErrorMessage(e instanceof Error ? e.message : undefined))
    }
  }

  const runBatch = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await annotationBatchImport({
        url: `/apps/${appId}/annotations/batch-import`,
        body: formData,
      })
      if (res.error_msg || !res.job_id || !res.job_status) {
        setImportStatus(ProcessStatus.ERROR)
        toast.error(getRunErrorMessage(res.error_msg))
        return
      }
      setImportStatus(res.job_status)
      checkProcess(res.job_id)
    }
    catch (e: unknown) {
      toast.error(getRunErrorMessage(e instanceof Error ? e.message : undefined))
    }
  }

  const handleSend = () => {
    if (!currentFile)
      return
    runBatch(currentFile)
  }

  return (
    <Dialog open={isShow}>
      <DialogContent className="w-full max-w-[520px]! overflow-hidden! rounded-xl! border-none px-8 py-6 text-left align-middle">

        <div className="relative pb-1 system-xl-medium text-text-primary">{t('batchModal.title', { ns: 'appAnnotation' })}</div>
        <button
          type="button"
          className="absolute top-4 right-4 cursor-pointer border-none bg-transparent p-2 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          aria-label={t('operation.close', { ns: 'common' })}
          onClick={onCancel}
        >
          <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
        </button>
        <CSVUploader
          file={currentFile}
          updateFile={handleFile}
        />
        <CSVDownloader />

        {isAnnotationFull && (
          <div className="mt-4">
            <AnnotationFull />
          </div>
        )}

        <div className="mt-[28px] flex justify-end pt-6">
          <Button className="mr-2 system-sm-medium text-text-tertiary" onClick={onCancel}>
            {t('batchModal.cancel', { ns: 'appAnnotation' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={isAnnotationFull || !currentFile}
            loading={importStatus === ProcessStatus.PROCESSING || importStatus === ProcessStatus.WAITING}
          >
            {t('batchModal.run', { ns: 'appAnnotation' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(BatchModal)
