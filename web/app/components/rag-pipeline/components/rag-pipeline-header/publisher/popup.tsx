import type { PublishWorkflowParams } from '@/types/workflow'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowRightUpLine, RiHammerLine, RiPlayCircleLine, RiTerminalBoxLine } from '@remixicon/react'
import { useBoolean, useKeyPress } from 'ahooks'
import { memo, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Divider from '@/app/components/base/divider'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useChecklistBeforePublish } from '@/app/components/workflow/hooks'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContextSelector } from '@/context/provider-context'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { useParams, useRouter } from '@/next/navigation'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useInvalid } from '@/service/use-base'
import { publishedPipelineInfoQueryKeyPrefix } from '@/service/use-pipeline'
import { usePublishWorkflow } from '@/service/use-workflow'

const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']
type PopupProps = {
  onRequestClose?: () => void
  confirmVisible?: boolean
  onShowConfirm?: () => void
  onHideConfirm?: () => void
  isPublishingAsCustomizedPipeline?: boolean
  onShowPublishAsKnowledgePipelineModal?: () => void
}

const Popup = ({
  onRequestClose,
  confirmVisible: controlledConfirmVisible,
  onShowConfirm,
  onHideConfirm,
  isPublishingAsCustomizedPipeline = false,
  onShowPublishAsKnowledgePipelineModal,
}: PopupProps) => {
  const { t } = useTranslation()
  const { datasetId } = useParams()
  const { push } = useRouter()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const pipelineId = useStore(s => s.pipelineId)
  const mutateDatasetRes = useDatasetDetailContextWithSelector(s => s.mutateDatasetRes)
  const [published, setPublished] = useState(false)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const { mutateAsync: publishWorkflow } = usePublishWorkflow()
  const workflowStore = useWorkflowStore()
  const isAllowPublishAsCustomKnowledgePipelineTemplate = useProviderContextSelector(s => s.isAllowPublishAsCustomKnowledgePipelineTemplate)
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)
  const apiReferenceUrl = useDatasetApiAccessUrl()
  const [localConfirmVisible, { setFalse: hideLocalConfirm, setTrue: showLocalConfirm }] = useBoolean(false)
  const confirmVisible = controlledConfirmVisible ?? localConfirmVisible
  const showConfirm = onShowConfirm ?? showLocalConfirm
  const hideConfirm = onHideConfirm ?? hideLocalConfirm
  const [publishing, { setFalse: hidePublishing, setTrue: showPublishing }] = useBoolean(false)
  const invalidPublishedPipelineInfo = useInvalid([...publishedPipelineInfoQueryKeyPrefix, pipelineId])
  const invalidDatasetList = useInvalidDatasetList()
  const handleHideConfirm = useCallback(() => {
    hideConfirm()
    onRequestClose?.()
  }, [hideConfirm, onRequestClose])
  const handlePublish = useCallback(async (params?: PublishWorkflowParams) => {
    if (publishing)
      return
    let startedPublishing = false
    try {
      const checked = await handleCheckBeforePublish()
      if (checked) {
        if (!publishedAt && !confirmVisible) {
          showConfirm()
          return
        }
        startedPublishing = true
        showPublishing()
        const res = await publishWorkflow({
          url: `/rag/pipelines/${pipelineId}/workflows/publish`,
          title: params?.title || '',
          releaseNotes: params?.releaseNotes || '',
        })
        setPublished(true)
        trackEvent('app_published_time', { action_mode: 'pipeline', app_id: datasetId, app_name: params?.title || '' })
        if (res) {
          toast.success(t('publishPipeline.success.message', { ns: 'datasetPipeline' }), {
            description: (
              <div className="system-xs-regular text-text-secondary">
                <Trans
                  i18nKey="publishPipeline.success.tip"
                  ns="datasetPipeline"
                  components={{
                    CustomLink: (
                      <Link className="system-xs-medium text-text-accent" href={`/datasets/${datasetId}/documents`}>
                      </Link>
                    ),
                  }}
                />
              </div>
            ),
          })
          workflowStore.getState().setPublishedAt(res.created_at)
          mutateDatasetRes?.()
          invalidPublishedPipelineInfo()
          invalidDatasetList()
        }
      }
    }
    catch {
      toast.error(t('publishPipeline.error.message', { ns: 'datasetPipeline' }))
    }
    finally {
      if (startedPublishing)
        hidePublishing()
      if (confirmVisible)
        handleHideConfirm()
    }
  }, [publishing, handleCheckBeforePublish, publishedAt, confirmVisible, showPublishing, publishWorkflow, pipelineId, datasetId, showConfirm, t, workflowStore, mutateDatasetRes, invalidPublishedPipelineInfo, invalidDatasetList, hidePublishing, handleHideConfirm])
  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (published)
      return
    handlePublish()
  }, { exactMatch: true, useCapture: true })
  const goToAddDocuments = useCallback(() => {
    push(`/datasets/${datasetId}/documents/create-from-pipeline`)
  }, [datasetId, push])
  const handleClickPublishAsKnowledgePipeline = useCallback(() => {
    onRequestClose?.()
    if (!isAllowPublishAsCustomKnowledgePipelineTemplate) {
      setShowPricingModal()
    }
    else {
      onShowPublishAsKnowledgePipelineModal?.()
    }
  }, [isAllowPublishAsCustomKnowledgePipelineTemplate, onRequestClose, onShowPublishAsKnowledgePipelineModal, setShowPricingModal])
  return (
    <div className={cn('rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5', isAllowPublishAsCustomKnowledgePipelineTemplate ? 'w-[360px]' : 'w-[400px]')}>
      <div className="p-4 pt-3">
        <div className="flex h-6 items-center system-xs-medium-uppercase text-text-tertiary">
          {publishedAt ? t('common.latestPublished', { ns: 'workflow' }) : t('common.currentDraftUnpublished', { ns: 'workflow' })}
        </div>
        {publishedAt
          ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center system-sm-medium text-text-secondary">
                  {t('common.publishedAt', { ns: 'workflow' })}
                  {' '}
                  {formatTimeFromNow(publishedAt)}
                </div>
              </div>
            )
          : (
              <div className="flex items-center system-sm-medium text-text-secondary">
                {t('common.autoSaved', { ns: 'workflow' })}
                {' '}
                ·
                {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
              </div>
            )}
        <Button variant="primary" className="mt-3 w-full" onClick={() => handlePublish()} disabled={published || publishing}>
          {published
            ? t('common.published', { ns: 'workflow' })
            : (
                <div className="flex gap-1">
                  <span>{t('common.publishUpdate', { ns: 'workflow' })}</span>
                  <ShortcutsName keys={PUBLISH_SHORTCUT} bgColor="white" />
                </div>
              )}
        </Button>
      </div>
      <div className="border-t-[0.5px] border-t-divider-regular p-4 pt-3">
        <Button className="mb-1 w-full hover:bg-state-accent-hover hover:text-text-accent" variant="tertiary" onClick={goToAddDocuments} disabled={!publishedAt}>
          <div className="flex grow items-center">
            <RiPlayCircleLine className="mr-2 h-4 w-4" />
            {t('common.goToAddDocuments', { ns: 'pipeline' })}
          </div>
          <RiArrowRightUpLine className="ml-2 h-4 w-4 shrink-0" />
        </Button>
        <Link href={apiReferenceUrl} target="_blank" rel="noopener noreferrer">
          <Button className="w-full hover:bg-state-accent-hover hover:text-text-accent" variant="tertiary" disabled={!publishedAt}>
            <div className="flex grow items-center">
              <RiTerminalBoxLine className="mr-2 h-4 w-4" />
              {t('common.accessAPIReference', { ns: 'workflow' })}
            </div>
            <RiArrowRightUpLine className="ml-2 h-4 w-4 shrink-0" />
          </Button>
        </Link>
        <Divider className="my-2" />
        <Button className="w-full hover:bg-state-accent-hover hover:text-text-accent" variant="tertiary" onClick={handleClickPublishAsKnowledgePipeline} disabled={!publishedAt || isPublishingAsCustomizedPipeline}>
          <div className="flex grow items-center gap-x-2 overflow-hidden">
            <RiHammerLine className="h-4 w-4 shrink-0" />
            <span className="grow truncate text-left" title={t('common.publishAs', { ns: 'pipeline' })}>
              {t('common.publishAs', { ns: 'pipeline' })}
            </span>
            {!isAllowPublishAsCustomKnowledgePipelineTemplate && (
              <PremiumBadge className="shrink-0 select-none" size="s" color="indigo">
                <SparklesSoft aria-hidden="true" className="flex size-3 items-center text-components-premium-badge-indigo-text-stop-0" />
                <span className="p-0.5 system-2xs-medium">
                  {t('upgradeBtn.encourageShort', { ns: 'billing' })}
                </span>
              </PremiumBadge>
            )}
          </div>
        </Button>
      </div>
      <AlertDialog open={confirmVisible} onOpenChange={open => !open && handleHideConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle
              title={t('common.confirmPublish', { ns: 'pipeline' })}
              className="w-full truncate title-2xl-semi-bold text-text-primary"
            >
              {t('common.confirmPublish', { ns: 'pipeline' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('common.confirmPublishContent', { ns: 'pipeline' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={publishing} onClick={() => void handlePublish()}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
export default memo(Popup)
