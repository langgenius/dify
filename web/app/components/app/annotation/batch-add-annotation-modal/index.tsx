'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { getCountQuota, isQuotaReached } from '@/app/components/billing/quota'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import CSVDownloader from './csv-downloader'
import CSVUploader from './csv-uploader'

export const ProcessStatus = {
  WAITING: 'waiting',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const

export type ProcessStatus = (typeof ProcessStatus)[keyof typeof ProcessStatus]

export type IBatchModalProps = {
  appId: string
  isShow: boolean
  onCancel: () => void
  onAdded: () => void
}

const BatchModal: FC<IBatchModalProps> = ({ appId, isShow, onCancel, onAdded }) => {
  const { t } = useTranslation(['appAnnotation', 'common'])
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => getCountQuota(data.annotation_quota_limit),
    }),
  )
  const isAnnotationQuotaUnavailable = annotationQuota === undefined
  const isAnnotationFull = annotationQuota !== undefined && isQuotaReached(annotationQuota)
  const [currentCSV, setCurrentCSV] = useState<File>()
  const handleFile = (file?: File) => setCurrentCSV(file)

  useEffect(() => {
    if (!isShow) setCurrentCSV(undefined)
  }, [isShow])

  const [importStatus, setImportStatus] = useState<ProcessStatus | string>()
  const checkProcess = async (jobID: string) => {
    try {
      const res = await consoleClient.apps.byAppId.annotations.batchImportStatus.byJobId.get({
        params: { app_id: appId, job_id: jobID },
      })
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
    try {
      const res = await consoleClient.apps.byAppId.annotations.batchImport.post({
        params: { app_id: appId },
        body: { file: csv },
      })
      setImportStatus(res.job_status ?? undefined)
      // A rejected CSV or quota check returns `error_msg` without a job to poll.
      if (!res.job_id) {
        toast.error(
          `${t(($) => $['batchModal.runError'], { ns: 'appAnnotation' })}${res.error_msg ? `: ${res.error_msg}` : ''}`,
        )
        return
      }
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
    <Dialog
      open={isShow}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="w-130">
        <DialogHeader>
          <DialogTitle>{t(($) => $['batchModal.title'], { ns: 'appAnnotation' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <CSVUploader file={currentCSV} updateFile={handleFile} />
          <CSVDownloader />

          {isAnnotationFull && (
            <div className="mt-4">
              <AnnotationFull />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="system-sm-medium text-text-tertiary" onClick={onCancel}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(BatchModal)
