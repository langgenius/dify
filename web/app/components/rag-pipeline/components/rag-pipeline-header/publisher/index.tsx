import type { IconInfo } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from '#i18n'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { useInvalidCustomizedTemplateList, usePublishAsCustomizedPipeline } from '@/service/use-pipeline'
import PublishAsKnowledgePipelineModal from '../../publish-as-knowledge-pipeline-modal'
import Popup from './popup'

const Publisher = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmVisible, { setFalse: hideConfirm, setTrue: showConfirm }] = useBoolean(false)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const canPipelineRelease = useHooksStore(s => s.accessControl.canReleaseAndVersion)
  const docLink = useDocLink()
  const pipelineId = useStore(s => s.pipelineId)
  const { mutateAsync: publishAsCustomizedPipeline } = usePublishAsCustomizedPipeline()
  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()
  const [showPublishAsKnowledgePipelineModal, setShowPublishAsKnowledgePipelineModal] = useState(false)
  const [isPublishingAsCustomizedPipeline, setIsPublishingAsCustomizedPipeline] = useState(false)

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen && confirmVisible)
      return
    if (newOpen && canPipelineRelease)
      handleSyncWorkflowDraft(true)
    setOpen(canPipelineRelease && newOpen)
  }, [confirmVisible, handleSyncWorkflowDraft, canPipelineRelease])
  const closePopover = useCallback(() => {
    setOpen(false)
  }, [])
  const openPublishAsKnowledgePipelineModal = useCallback(() => {
    setShowPublishAsKnowledgePipelineModal(true)
  }, [])
  const hidePublishAsKnowledgePipelineModal = useCallback(() => {
    setShowPublishAsKnowledgePipelineModal(false)
  }, [])
  const handlePublishAsKnowledgePipeline = useCallback(async (name: string, icon: IconInfo, description?: string) => {
    try {
      setIsPublishingAsCustomizedPipeline(true)
      await publishAsCustomizedPipeline({
        pipelineId: pipelineId || '',
        name,
        icon_info: icon,
        description,
      })
      toast.success(t('publishTemplate.success.message', { ns: 'datasetPipeline' }), {
        description: (
          <div className="flex flex-col gap-y-1">
            <span className="system-xs-regular text-text-secondary">
              {t('publishTemplate.success.tip', { ns: 'datasetPipeline' })}
            </span>
            <Link href={docLink()} target="_blank" className="inline-block system-xs-medium-uppercase text-text-accent">
              {t('publishTemplate.success.learnMore', { ns: 'datasetPipeline' })}
            </Link>
          </div>
        ),
      })
      invalidCustomizedTemplateList()
    }
    catch {
      toast.error(t('publishTemplate.error.message', { ns: 'datasetPipeline' }))
    }
    finally {
      setIsPublishingAsCustomizedPipeline(false)
      hidePublishAsKnowledgePipelineModal()
    }
  }, [docLink, hidePublishAsKnowledgePipelineModal, invalidCustomizedTemplateList, pipelineId, publishAsCustomizedPipeline, t])

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
      >
        <PopoverTrigger
          nativeButton
          render={(
            <Button
              className="px-2"
              variant="primary"
              disabled={!canPipelineRelease}
            >
              <span className="pl-1">{t('common.publish', { ns: 'workflow' })}</span>
              <RiArrowDownSLine className="size-4" />
            </Button>
          )}
        />
        <PopoverContent
          placement="bottom-end"
          sideOffset={4}
          alignOffset={40}
          popupClassName={cn('border-none bg-transparent shadow-none', confirmVisible && 'hidden')}
        >
          <Popup
            onRequestClose={closePopover}
            confirmVisible={confirmVisible}
            onShowConfirm={showConfirm}
            onHideConfirm={hideConfirm}
            isPublishingAsCustomizedPipeline={isPublishingAsCustomizedPipeline}
            onShowPublishAsKnowledgePipelineModal={openPublishAsKnowledgePipelineModal}
          />
        </PopoverContent>
      </Popover>
      {showPublishAsKnowledgePipelineModal && (
        <PublishAsKnowledgePipelineModal
          confirmDisabled={isPublishingAsCustomizedPipeline}
          onConfirm={handlePublishAsKnowledgePipeline}
          onCancel={hidePublishAsKnowledgePipelineModal}
        />
      )}
    </>
  )
}

export default memo(Publisher)
