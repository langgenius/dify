import type { IconInfo } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import PublishAsKnowledgePipelineModal from '../../publish-as-knowledge-pipeline-modal'
import { Popup } from './popup'

const Publisher = () => {
  const { t } = useTranslation(['datasetPipeline', 'workflow'])
  const [open, setOpen] = useState(false)
  const [confirmVisible, { setFalse: hideConfirm, setTrue: showConfirm }] = useBoolean(false)
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const canPipelineRelease = useHooksStore((s) => s.accessControl.canReleaseAndVersion)
  const docLink = useDocLink()
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const queryClient = useQueryClient()
  const { mutateAsync: publishAsCustomizedPipeline } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.customized.publish.post.mutationOptions(),
  )
  const [showPublishAsKnowledgePipelineModal, setShowPublishAsKnowledgePipelineModal] =
    useState(false)
  const [isPublishingAsCustomizedPipeline, setIsPublishingAsCustomizedPipeline] = useState(false)

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && confirmVisible) return
      if (newOpen && canPipelineRelease) handleSyncWorkflowDraft(true)
      setOpen(canPipelineRelease && newOpen)
    },
    [confirmVisible, handleSyncWorkflowDraft, canPipelineRelease],
  )
  const closePopover = useCallback(() => {
    setOpen(false)
  }, [])
  const openPublishAsKnowledgePipelineModal = useCallback(() => {
    setShowPublishAsKnowledgePipelineModal(true)
  }, [])
  const hidePublishAsKnowledgePipelineModal = useCallback(() => {
    setShowPublishAsKnowledgePipelineModal(false)
  }, [])
  const handlePublishAsKnowledgePipeline = useCallback(
    async (name: string, icon: IconInfo, description?: string) => {
      try {
        setIsPublishingAsCustomizedPipeline(true)
        await publishAsCustomizedPipeline({
          params: { pipeline_id: pipelineId || '' },
          body: { name, icon_info: icon, description },
        })
        toast.success(
          t(($) => $['publishTemplate.success.message'], { ns: 'datasetPipeline' }),
          {
            description: (
              <div className="flex flex-col gap-y-1">
                <span className="system-xs-regular text-text-secondary">
                  {t(($) => $['publishTemplate.success.tip'], { ns: 'datasetPipeline' })}
                </span>
                <Link
                  href={docLink()}
                  target="_blank"
                  className="inline-block system-xs-medium-uppercase text-text-accent"
                >
                  {t(($) => $['publishTemplate.success.learnMore'], { ns: 'datasetPipeline' })}
                </Link>
              </div>
            ),
          },
        )
        queryClient.invalidateQueries({
          queryKey: consoleQuery.rag.pipeline.templates.get.queryKey({
            input: { query: { type: 'customized' } },
          }),
        })
      } catch {
        toast.error(t(($) => $['publishTemplate.error.message'], { ns: 'datasetPipeline' }))
      } finally {
        setIsPublishingAsCustomizedPipeline(false)
        hidePublishAsKnowledgePipelineModal()
      }
    },
    [
      docLink,
      hidePublishAsKnowledgePipelineModal,
      queryClient,
      pipelineId,
      publishAsCustomizedPipeline,
      t,
    ],
  )

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          nativeButton
          render={
            <Button className="px-2" variant="primary" disabled={!canPipelineRelease}>
              <span>{t(($) => $['common.publish'], { ns: 'workflow' })}</span>
              <RiArrowDownSLine className="size-4" />
            </Button>
          }
        />
        <PopoverContent
          align="end"
          sideOffset={4}
          alignOffset={40}
          className={cn('border-none bg-transparent shadow-none', confirmVisible && 'hidden')}
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
