import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  useNodesReadOnly,
  useNodesSyncDraft,
  useWorkflow,
  useWorkflowRun,
} from '../hooks'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { publishWorkflow } from '@/service/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useToastContext } from '@/app/components/base/toast'

const Publish = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [published, setPublished] = useState(false)
  const workflowStore = useWorkflowStore()
  const { formatTimeFromNow } = useWorkflow()
  const {
    handleBackupDraft,
    handleCheckBeforePublish,
    handleRestoreFromPublishedWorkflow,
  } = useWorkflowRun()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const publishedAt = useStore(s => s.publishedAt)
  const [open, setOpen] = useState(false)

  const handlePublish = async () => {
    const appId = useAppStore.getState().appDetail?.id

    if (handleCheckBeforePublish()) {
      try {
        const res = await publishWorkflow(`/apps/${appId}/workflows/publish`)

        if (res) {
          notify({ type: 'success', message: t('common.api.actionSuccess') })
          setPublished(true)
          workflowStore.getState().setPublishedAt(res.created_at)
        }
      }
      catch (e) {
        setPublished(false)
      }
    }
  }

  const handleRestore = useCallback(() => {
    workflowStore.getState().setIsRestoring(true)
    handleBackupDraft()
    handleRestoreFromPublishedWorkflow()
    setOpen(false)
  }, [workflowStore, handleBackupDraft, handleRestoreFromPublishedWorkflow])

  const handleTrigger = useCallback(() => {
    if (getNodesReadOnly())
      return

    if (open)
      setOpen(false)

    if (!open) {
      handleSyncWorkflowDraft(true)
      setOpen(true)
      setPublished(false)
    }
  }, [getNodesReadOnly, open, handleSyncWorkflowDraft])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -5,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <Button
          type='primary'
          className={`
            px-3 py-0 h-8 text-[13px] font-medium
            ${nodesReadOnly && 'cursor-not-allowed opacity-50'}
          `}
        >
          {t('workflow.common.publish')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[320px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl'>
          <div className='p-4 pt-3'>
            <div className='flex items-center h-6 text-xs font-medium text-gray-500'>
              {t('workflow.common.currentDraft').toLocaleUpperCase()}
            </div>
            <div className='flex items-center h-[18px] text-[13px] font-medium text-gray-700'>
              {t('workflow.common.autoSaved')} {formatTimeFromNow(draftUpdatedAt)}
            </div>
            <Button
              type='primary'
              className={`
                mt-3 px-3 py-0 w-full h-8 border-[0.5px] border-primary-700 rounded-lg text-[13px] font-medium
                ${published && 'border-transparent'}
              `}
              onClick={handlePublish}
              disabled={published}
            >
              {
                published
                  ? t('workflow.common.published')
                  : t('workflow.common.publish')
              }
            </Button>
          </div>
          {
            !!publishedAt && (
              <div className='p-4 pt-3 border-t-[0.5px] border-t-black/5'>
                <div className='flex items-center h-6 text-xs font-medium text-gray-500'>
                  {t('workflow.common.latestPublished').toLocaleUpperCase()}
                </div>
                <div className='flex justify-between'>
                  <div className='flex items-center mt-[3px] mb-[3px] leading-[18px] text-[13px] font-medium text-gray-700'>
                    {t('workflow.common.autoSaved')} {formatTimeFromNow(publishedAt)}
                  </div>
                  <Button
                    className={`
                      ml-2 px-2 py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] border-gray-200
                      ${published && 'opacity-50 border-transparent shadow-none bg-transparent'}
                    `}
                    onClick={handleRestore}
                    disabled={published}
                  >
                    {t('workflow.common.restore')}
                  </Button>
                </div>
              </div>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Publish)
