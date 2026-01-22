import type { IconInfo } from '@/models/datasets'
import type { PublishWorkflowParams } from '@/types/workflow'
import {
  RiArrowRightUpLine,
  RiHammerLine,
  RiPlayCircleLine,
  RiTerminalBoxLine,
} from '@remixicon/react'
import {
  useBoolean,
  useKeyPress,
} from 'ahooks'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useToastContext } from '@/app/components/base/toast'
import {
  useChecklistBeforePublish,
} from '@/app/components/workflow/hooks'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useInvalid } from '@/service/use-base'
import {
  publishedPipelineInfoQueryKeyPrefix,
  useInvalidCustomizedTemplateList,
  usePublishAsCustomizedPipeline,
} from '@/service/use-pipeline'
import { usePublishWorkflow } from '@/service/use-workflow'
import { cn } from '@/utils/classnames'
import PublishAsKnowledgePipelineModal from '../../publish-as-knowledge-pipeline-modal'

const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']

const Popup = () => {
  const { t } = useTranslation()
  const { datasetId } = useParams()
  const { push } = useRouter()
  const docLink = useDocLink()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const pipelineId = useStore(s => s.pipelineId)
  const mutateDatasetRes = useDatasetDetailContextWithSelector(s => s.mutateDatasetRes)
  const [published, setPublished] = useState(false)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const { mutateAsync: publishWorkflow } = usePublishWorkflow()
  const { notify } = useToastContext()
  const workflowStore = useWorkflowStore()
  const { isAllowPublishAsCustomKnowledgePipelineTemplate } = useProviderContext()
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)
  const apiReferenceUrl = useDatasetApiAccessUrl()

  const [confirmVisible, {
    setFalse: hideConfirm,
    setTrue: showConfirm,
  }] = useBoolean(false)
  const [publishing, {
    setFalse: hidePublishing,
    setTrue: showPublishing,
  }] = useBoolean(false)
  const {
    mutateAsync: publishAsCustomizedPipeline,
  } = usePublishAsCustomizedPipeline()
  const [showPublishAsKnowledgePipelineModal, {
    setFalse: hidePublishAsKnowledgePipelineModal,
    setTrue: setShowPublishAsKnowledgePipelineModal,
  }] = useBoolean(false)
  const [isPublishingAsCustomizedPipeline, {
    setFalse: hidePublishingAsCustomizedPipeline,
    setTrue: showPublishingAsCustomizedPipeline,
  }] = useBoolean(false)

  const invalidPublishedPipelineInfo = useInvalid([...publishedPipelineInfoQueryKeyPrefix, pipelineId])
  const invalidDatasetList = useInvalidDatasetList()

  const handlePublish = useCallback(async (params?: PublishWorkflowParams) => {
    if (publishing)
      return
    try {
      const checked = await handleCheckBeforePublish()

      if (checked) {
        if (!publishedAt && !confirmVisible) {
          showConfirm()
          return
        }
        showPublishing()
        const res = await publishWorkflow({
          url: `/rag/pipelines/${pipelineId}/workflows/publish`,
          title: params?.title || '',
          releaseNotes: params?.releaseNotes || '',
        })
        setPublished(true)
        trackEvent('app_published_time', { action_mode: 'pipeline', app_id: datasetId, app_name: params?.title || '' })
        if (res) {
          notify({
            type: 'success',
            message: t('publishPipeline.success.message', { ns: 'datasetPipeline' }),
            children: (
              <div className="system-xs-regular text-text-secondary">
                <Trans
                  i18nKey="publishPipeline.success.tip"
                  ns="datasetPipeline"
                  components={{
                    CustomLink: (
                      <Link
                        className="system-xs-medium text-text-accent"
                        href={`/datasets/${datasetId}/documents`}
                      >
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
      notify({ type: 'error', message: t('publishPipeline.error.message', { ns: 'datasetPipeline' }) })
    }
    finally {
      if (publishing)
        hidePublishing()
      if (confirmVisible)
        hideConfirm()
    }
  }, [handleCheckBeforePublish, publishWorkflow, pipelineId, notify, t, workflowStore, mutateDatasetRes, invalidPublishedPipelineInfo, showConfirm, publishedAt, confirmVisible, hidePublishing, showPublishing, hideConfirm, publishing])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (published)
      return
    handlePublish()
  }, { exactMatch: true, useCapture: true })

  const goToAddDocuments = useCallback(() => {
    push(`/datasets/${datasetId}/documents/create-from-pipeline`)
  }, [datasetId, push])

  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()

  const handlePublishAsKnowledgePipeline = useCallback(async (
    name: string,
    icon: IconInfo,
    description?: string,
  ) => {
    try {
      showPublishingAsCustomizedPipeline()
      await publishAsCustomizedPipeline({
        pipelineId: pipelineId || '',
        name,
        icon_info: icon,
        description,
      })
      notify({
        type: 'success',
        message: t('publishTemplate.success.message', { ns: 'datasetPipeline' }),
        children: (
          <div className="flex flex-col gap-y-1">
            <span className="system-xs-regular text-text-secondary">
              {t('publishTemplate.success.tip', { ns: 'datasetPipeline' })}
            </span>
            <Link
              href={docLink()}
              target="_blank"
              className="system-xs-medium-uppercase inline-block text-text-accent"
            >
              {t('publishTemplate.success.learnMore', { ns: 'datasetPipeline' })}
            </Link>
          </div>
        ),
      })
      invalidCustomizedTemplateList()
    }
    catch {
      notify({ type: 'error', message: t('publishTemplate.error.message', { ns: 'datasetPipeline' }) })
    }
    finally {
      hidePublishingAsCustomizedPipeline()
      hidePublishAsKnowledgePipelineModal()
    }
  }, [
    pipelineId,
    publishAsCustomizedPipeline,
    showPublishingAsCustomizedPipeline,
    hidePublishingAsCustomizedPipeline,
    hidePublishAsKnowledgePipelineModal,
    notify,
    t,
  ])

  const handleClickPublishAsKnowledgePipeline = useCallback(() => {
    if (!isAllowPublishAsCustomKnowledgePipelineTemplate)
      setShowPricingModal()
    else
      setShowPublishAsKnowledgePipelineModal()
  }, [isAllowPublishAsCustomKnowledgePipelineTemplate, setShowPublishAsKnowledgePipelineModal, setShowPricingModal])

  return (
    <div className={cn('rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5', isAllowPublishAsCustomKnowledgePipelineTemplate ? 'w-[360px]' : 'w-[400px]')}>
      <div className="p-4 pt-3">
        <div className="system-xs-medium-uppercase flex h-6 items-center text-text-tertiary">
          {publishedAt ? t('common.latestPublished', { ns: 'workflow' }) : t('common.currentDraftUnpublished', { ns: 'workflow' })}
        </div>
        {
          publishedAt
            ? (
                <div className="flex items-center justify-between">
                  <div className="system-sm-medium flex items-center text-text-secondary">
                    {t('common.publishedAt', { ns: 'workflow' })}
                    {' '}
                    {formatTimeFromNow(publishedAt)}
                  </div>
                </div>
              )
            : (
                <div className="system-sm-medium flex items-center text-text-secondary">
                  {t('common.autoSaved', { ns: 'workflow' })}
                  {' '}
                  ·
                  {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
                </div>
              )
        }
        <Button
          variant="primary"
          className="mt-3 w-full"
          onClick={() => handlePublish()}
          disabled={published || publishing}
        >
          {
            published
              ? t('common.published', { ns: 'workflow' })
              : (
                  <div className="flex gap-1">
                    <span>{t('common.publishUpdate', { ns: 'workflow' })}</span>
                    <div className="flex gap-0.5">
                      {PUBLISH_SHORTCUT.map(key => (
                        <span key={key} className="system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface">
                          {getKeyboardKeyNameBySystem(key)}
                        </span>
                      ))}
                    </div>
                  </div>
                )
          }
        </Button>
      </div>
      <div className="border-t-[0.5px] border-t-divider-regular p-4 pt-3">
        <Button
          className="mb-1 w-full hover:bg-state-accent-hover hover:text-text-accent"
          variant="tertiary"
          onClick={goToAddDocuments}
          disabled={!publishedAt}
        >
          <div className="flex grow items-center">
            <RiPlayCircleLine className="mr-2 h-4 w-4" />
            {t('common.goToAddDocuments', { ns: 'pipeline' })}
          </div>
          <RiArrowRightUpLine className="ml-2 h-4 w-4 shrink-0" />
        </Button>
        <Link
          href={apiReferenceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button
            className="w-full hover:bg-state-accent-hover hover:text-text-accent"
            variant="tertiary"
            disabled={!publishedAt}
          >
            <div className="flex grow items-center">
              <RiTerminalBoxLine className="mr-2 h-4 w-4" />
              {t('common.accessAPIReference', { ns: 'workflow' })}
            </div>
            <RiArrowRightUpLine className="ml-2 h-4 w-4 shrink-0" />
          </Button>
        </Link>
        <Divider className="my-2" />
        <Button
          className="w-full hover:bg-state-accent-hover hover:text-text-accent"
          variant="tertiary"
          onClick={handleClickPublishAsKnowledgePipeline}
          disabled={!publishedAt || isPublishingAsCustomizedPipeline}
        >
          <div className="flex grow items-center gap-x-2 overflow-hidden">
            <RiHammerLine className="h-4 w-4 shrink-0" />
            <span className="grow truncate text-left" title={t('common.publishAs', { ns: 'pipeline' })}>
              {t('common.publishAs', { ns: 'pipeline' })}
            </span>
            {!isAllowPublishAsCustomKnowledgePipelineTemplate && (
              <PremiumBadge className="shrink-0 cursor-pointer select-none" size="s" color="indigo">
                <SparklesSoft className="flex size-3 items-center text-components-premium-badge-indigo-text-stop-0" />
                <span className="system-2xs-medium p-0.5">
                  {t('upgradeBtn.encourageShort', { ns: 'billing' })}
                </span>
              </PremiumBadge>
            )}
          </div>
        </Button>
      </div>
      {
        confirmVisible && (
          <Confirm
            isShow={confirmVisible}
            title={t('common.confirmPublish', { ns: 'pipeline' })}
            content={t('common.confirmPublishContent', { ns: 'pipeline' })}
            onCancel={hideConfirm}
            onConfirm={handlePublish}
            isDisabled={publishing}
          />
        )
      }
      {
        showPublishAsKnowledgePipelineModal && (
          <PublishAsKnowledgePipelineModal
            confirmDisabled={isPublishingAsCustomizedPipeline}
            onConfirm={handlePublishAsKnowledgePipeline}
            onCancel={hidePublishAsKnowledgePipelineModal}
          />
        )
      }
    </div>
  )
}

export default memo(Popup)
