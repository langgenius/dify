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
import { useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import Button from '@/app/components/base/button'
import {
  useChecklistBeforePublish,
  useFormatTimeFromNow,
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
  usePublishAsCustomizedPipeline,
} from '@/service/use-pipeline'
import Confirm from '@/app/components/base/confirm'
import PublishAsKnowledgePipelineModal from '../../publish-as-knowledge-pipeline-modal'
import type { IconInfo } from '@/models/datasets'

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
          notify({ type: 'success', message: t('common.api.actionSuccess') })
          workflowStore.getState().setPublishedAt(res.created_at)
          mutateDatasetRes?.()
          invalidPublishedPipelineInfo()
        }
      }
    }
    catch {
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
  },
    { exactMatch: true, useCapture: true },
  )

  const goToAddDocuments = useCallback(() => {
    push(`/datasets/${datasetId}/documents/create-from-pipeline`)
  }, [datasetId, push])

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
      notify({ type: 'success', message: t('common.api.actionSuccess') })
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

  return (
    <div className='w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5'>
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
        <a href='/datasets?category=api' target='_blank'>
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
        </a>
        <Divider className='my-2' />
        <Button
          className='w-full hover:bg-state-accent-hover hover:text-text-accent'
          variant='tertiary'
          onClick={setShowPublishAsKnowledgePipelineModal}
          disabled={!publishedAt || isPublishingAsCustomizedPipeline}
        >
          <div className='flex grow items-center'>
            <RiHammerLine className='mr-2 h-4 w-4' />
            {t('pipeline.common.publishAs')}
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
