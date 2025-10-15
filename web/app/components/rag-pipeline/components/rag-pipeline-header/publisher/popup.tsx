import {
  memo,
  useCallback,
  useState,
} from 'react'
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
import { Trans, useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import Button from '@/app/components/base/button'
import {
  useChecklistBeforePublish,
} from '@/app/components/workflow/hooks'
import Divider from '@/app/components/base/divider'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import { usePublishWorkflow } from '@/service/use-workflow'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useToastContext } from '@/app/components/base/toast'
import { useParams, useRouter } from 'next/navigation'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useInvalid } from '@/service/use-base'
import {
  publishedPipelineInfoQueryKeyPrefix,
  useInvalidCustomizedTemplateList,
  usePublishAsCustomizedPipeline,
} from '@/service/use-pipeline'
import Confirm from '@/app/components/base/confirm'
import PublishAsKnowledgePipelineModal from '../../publish-as-knowledge-pipeline-modal'
import type { IconInfo } from '@/models/datasets'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useProviderContext } from '@/context/provider-context'
import classNames from '@/utils/classnames'
import PremiumBadge from '@/app/components/base/premium-badge'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import { useModalContextSelector } from '@/context/modal-context'
import Link from 'next/link'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']

const Popup = () => {
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
        if (res) {
          notify({
            type: 'success',
            message: t('datasetPipeline.publishPipeline.success.message'),
            children: (
              <div className='system-xs-regular text-text-secondary'>
                <Trans
                  i18nKey='datasetPipeline.publishPipeline.success.tip'
                  components={{
                    CustomLink: (
                      <Link
                        className='system-xs-medium text-text-accent'
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
      notify({ type: 'error', message: t('datasetPipeline.publishPipeline.error.message') })
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
        message: t('datasetPipeline.publishTemplate.success.message'),
        children: (
          <div className='flex flex-col gap-y-1'>
            <span className='system-xs-regular text-text-secondary'>
              {t('datasetPipeline.publishTemplate.success.tip')}
            </span>
            <Link
              href='https://docs.dify.ai'
              target='_blank'
              className='system-xs-medium-uppercase inline-block text-text-accent'
            >
              {t('datasetPipeline.publishTemplate.success.learnMore')}
            </Link>
          </div>
        ),
      })
      invalidCustomizedTemplateList()
    }
    catch {
      notify({ type: 'error', message: t('datasetPipeline.publishTemplate.error.message') })
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
    <div className={classNames(
      'rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5',
      isAllowPublishAsCustomKnowledgePipelineTemplate ? 'w-[360px]' : 'w-[400px]',
    )}>
      <div className='p-4 pt-3'>
        <div className='system-xs-medium-uppercase flex h-6 items-center text-text-tertiary'>
          {publishedAt ? t('workflow.common.latestPublished') : t('workflow.common.currentDraftUnpublished')}
        </div>
        {
          publishedAt
            ? (
              <div className='flex items-center justify-between'>
                <div className='system-sm-medium flex items-center text-text-secondary'>
                  {t('workflow.common.publishedAt')} {formatTimeFromNow(publishedAt)}
                </div>
              </div>
            )
            : (
              <div className='system-sm-medium flex items-center text-text-secondary'>
                {t('workflow.common.autoSaved')} · {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
              </div>
            )
        }
        <Button
          variant='primary'
          className='mt-3 w-full'
          onClick={() => handlePublish()}
          disabled={published || publishing}
        >
          {
            published
              ? t('workflow.common.published')
              : (
                <div className='flex gap-1'>
                  <span>{t('workflow.common.publishUpdate')}</span>
                  <div className='flex gap-0.5'>
                    {PUBLISH_SHORTCUT.map(key => (
                      <span key={key} className='system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface'>
                        {getKeyboardKeyNameBySystem(key)}
                      </span>
                    ))}
                  </div>
                </div>
              )
          }
        </Button>
      </div>
      <div className='border-t-[0.5px] border-t-divider-regular p-4 pt-3'>
        <Button
          className='mb-1 w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
          onClick={goToAddDocuments}
          disabled={!publishedAt}
        >
          <div className='flex grow items-center'>
            <RiPlayCircleLine className='mr-2 h-4 w-4' />
            {t('pipeline.common.goToAddDocuments')}
          </div>
          <RiArrowRightUpLine className='ml-2 h-4 w-4 shrink-0' />
        </Button>
        <Link
          href={apiReferenceUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          <Button
            className='w-full hover:bg-state-accent-hover hover:text-text-accent'
            variant='tertiary'
            disabled={!publishedAt}
          >
            <div className='flex grow items-center'>
              <RiTerminalBoxLine className='mr-2 h-4 w-4' />
              {t('workflow.common.accessAPIReference')}
            </div>
            <RiArrowRightUpLine className='ml-2 h-4 w-4 shrink-0' />
          </Button>
        </Link>
        <Divider className='my-2' />
        <Button
          className='w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
          onClick={handleClickPublishAsKnowledgePipeline}
          disabled={!publishedAt || isPublishingAsCustomizedPipeline}
        >
          <div className='flex grow items-center gap-x-2 overflow-hidden'>
            <RiHammerLine className='h-4 w-4 shrink-0' />
            <span className='grow truncate text-left' title={t('pipeline.common.publishAs')}>
              {t('pipeline.common.publishAs')}
            </span>
            {!isAllowPublishAsCustomKnowledgePipelineTemplate && (
              <PremiumBadge className='shrink-0 cursor-pointer select-none' size='s' color='indigo'>
                <SparklesSoft className='flex size-3 items-center text-components-premium-badge-indigo-text-stop-0' />
                <span className='system-2xs-medium p-0.5'>
                  {t('billing.upgradeBtn.encourageShort')}
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
            title={t('pipeline.common.confirmPublish')}
            content={t('pipeline.common.confirmPublishContent')}
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
