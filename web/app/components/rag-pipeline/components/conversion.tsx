import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import { useParams } from '@/next/navigation'
import { datasetDetailQueryKeyPrefix } from '@/service/knowledge/use-dataset'
import { useInvalid } from '@/service/use-base'
import { useConvertDatasetToPipeline } from '@/service/use-pipeline'
import PipelineScreenShot from './screenshot'

const Conversion = () => {
  const { t } = useTranslation()
  const { datasetId } = useParams()
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const { mutateAsync: convert, isPending } = useConvertDatasetToPipeline()
  const invalidDatasetDetail = useInvalid([...datasetDetailQueryKeyPrefix, datasetId])
  const handleConvert = useCallback(() => {
    convert(datasetId as string, {
      onSuccess: (res) => {
        if (res.status === 'success') {
          toast.success(t('conversion.successMessage', { ns: 'datasetPipeline' }))
          setShowConfirmModal(false)
          invalidDatasetDetail()
        }
        else if (res.status === 'failed') {
          toast.error(t('conversion.errorMessage', { ns: 'datasetPipeline' }))
        }
      },
      onError: () => {
        toast.error(t('conversion.errorMessage', { ns: 'datasetPipeline' }))
      },
    })
  }, [convert, datasetId, invalidDatasetDetail, t])
  const handleShowConfirmModal = useCallback(() => {
    setShowConfirmModal(true)
  }, [])
  const handleCancelConversion = useCallback(() => {
    setShowConfirmModal(false)
  }, [])
  const confirmTitle = t('conversion.confirm.title', { ns: 'datasetPipeline' })
  const confirmContent = t('conversion.confirm.content', { ns: 'datasetPipeline' })
  return (
    <div className="flex h-full w-full items-center justify-center bg-background-body p-6 pb-16">
      <div className="flex rounded-2xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-sm shadow-shadow-shadow-4">
        <div className="flex max-w-[480px] flex-col justify-between p-10">
          <div className="flex flex-col gap-y-2.5">
            <div className="title-4xl-semi-bold text-text-primary">
              {t('conversion.title', { ns: 'datasetPipeline' })}
            </div>
            <div className="body-md-medium">
              <span className="text-text-secondary">{t('conversion.descriptionChunk1', { ns: 'datasetPipeline' })}</span>
              <span className="text-text-tertiary">{t('conversion.descriptionChunk2', { ns: 'datasetPipeline' })}</span>
            </div>
          </div>
          <div className="flex items-center gap-x-4">
            <Button variant="primary" className="w-32" onClick={handleShowConfirmModal}>
              {t('operations.convert', { ns: 'datasetPipeline' })}
            </Button>
            <span className="system-xs-regular text-text-warning">
              {t('conversion.warning', { ns: 'datasetPipeline' })}
            </span>
          </div>
        </div>
        <div className="pt-6 pr-0 pb-8 pl-[25px]">
          <div className="rounded-l-xl border border-effects-highlight bg-background-default p-1 shadow-md shadow-shadow-shadow-5 backdrop-blur-[5px]">
            <div className="overflow-hidden rounded-l-lg">
              <PipelineScreenShot />
            </div>
          </div>
        </div>
      </div>
      <AlertDialog open={showConfirmModal} onOpenChange={open => !open && handleCancelConversion()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {confirmContent}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isPending} disabled={isPending} onClick={handleConvert}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
export default React.memo(Conversion)
