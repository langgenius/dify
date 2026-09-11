'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { annotationBatchImport, checkAnnotationBatchImportProgress } from '@/service/annotation'
import { consoleQuery } from '@/service/console'
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

const BatchModal: FC<IBatchModalProps> = ({ appId, isShow, onCancel, onAdded }) => {
  const { t } = useTranslation()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.annotation_quota_limit,
    }),
  )
  const isAnnotationQuotaUnavailable =
    deploymentEdition === 'CLOUD' && annotationQuota === undefined
  // A limit of 0 means unlimited.
  const isAnnotationFull =
    deploymentEdition === 'CLOUD' &&
    annotationQuota !== undefined &&
    annotationQuota.limit > 0 &&
    annotationQuota.size >= annotationQuota.limit
  const [currentCSV, setCurrentCSV] = useState<File>()
  const handleFile = (file?: File) => setCurrentCSV(file)

  useEffect(() => {
    if (!isShow) setCurrentCSV(undefined)
  }, [isShow])

  const [importStatus, setImportStatus] = useState<ProcessStatus | string>()
  const checkProcess = async (jobID: string) => {
    try {
      const res = await checkAnnotationBatchImportProgress({ jobID, appId })
      setImportStatus(res.job_status)
      if (res.job_status === ProcessStatus.WAITING || res.job_status === ProcessStatus.PROCESSING)
        setTimeout(() => checkProcess(res.job_id), 2500)
      if (res.job_status === ProcessStatus.ERROR)
        toast.error(`${t(($) => $['batchModal.runError'], { ns: 'appAnnotation' })}`)
      if (res.job_status === ProcessStatus.COMPLETED) {
        toast.success(`${t(($) => $['batchModal.completed'], { ns: 'appAnnotation' })}`)
        onAdded()
        onCancel()
      }
    } catch (e: any) {
      toast.error(
        `${t(($) => $['batchModal.runError'], { ns: 'appAnnotation' })}${'message' in e ? `: ${e.message}` : ''}`,
      )
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
    } catch (e: any) {
      toast.error(
        `${t(($) => $['batchModal.runError'], { ns: 'appAnnotation' })}${'message' in e ? `: ${e.message}` : ''}`,
      )
    }
  }

  const handleSend = () => {
    if (!currentCSV) return
    runBatch(currentCSV)
  }

  return (
    <Dialog open={isShow}>
      <DialogContent className="w-full max-w-130! overflow-hidden! rounded-xl! border-none px-8 py-6 text-left align-middle">
        <div className="relative pb-1 system-xl-medium text-text-primary">
          {t(($) => $['batchModal.title'], { ns: 'appAnnotation' })}
        </div>
        <button
          type="button"
          className="absolute top-4 right-4 cursor-pointer border-none bg-transparent p-2 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onCancel}
        >
          <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
        </button>
        <CSVUploader file={currentCSV} updateFile={handleFile} />
        <CSVDownloader />

        {isAnnotationFull && (
          <div className="mt-4">
            <AnnotationFull />
          </div>
        )}

        <div className="mt-7 flex justify-end pt-6">
          <Button className="mr-2 system-sm-medium text-text-tertiary" onClick={onCancel}>
            {t(($) => $['batchModal.cancel'], { ns: 'appAnnotation' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={isAnnotationQuotaUnavailable || isAnnotationFull || !currentCSV}
            loading={
              importStatus === ProcessStatus.PROCESSING || importStatus === ProcessStatus.WAITING
            }
          >
            {t(($) => $['batchModal.run'], { ns: 'appAnnotation' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(BatchModal)
