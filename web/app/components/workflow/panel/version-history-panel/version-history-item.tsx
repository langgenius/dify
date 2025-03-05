import React, { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { VersionHistoryContextMenuOptions, WorkflowVersion } from '../../types'
import ContextMenu from './context-menu'
import RestoreConfirmModal from './restore-confirm-modal'
import cn from '@/utils/classnames'
import type { VersionHistory } from '@/types/workflow'
import { useStore, useWorkflowStore } from '../../store'
import { useNodesSyncDraft, useWorkflowRun } from '../../hooks'
import DeleteConfirmModal from './delete-confirm-modal'
import VersionInfoModal from '@/app/components/app/app-publisher/version-info-modal'
import { useDeleteWorkflow, useResetWorkflowVersionHistory, useUpdateWorkflow } from '@/service/use-workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'

type VersionHistoryItemProps = {
  item: VersionHistory
  currentVersion: VersionHistory | null
  onClick: (item: VersionHistory) => void
  curIdx: number
  page: number
  isLast: boolean
}

const formatVersion = (version: string, curIdx: number, page: number): string => {
  if (curIdx === 0 && page === 1)
    return WorkflowVersion.Draft
  if (curIdx === 1 && page === 1)
    return WorkflowVersion.Latest
  try {
    const date = new Date(version)
    if (Number.isNaN(date.getTime()))
      return version

    // format as YYYY-MM-DD HH:mm:ss
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }
  catch {
    return version
  }
}

const VersionHistoryItem: React.FC<VersionHistoryItemProps> = ({
  item,
  currentVersion,
  onClick,
  curIdx,
  page,
  isLast,
}) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const appDetail = useAppStore.getState().appDetail
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)
  const { handleRestoreFromPublishedWorkflow } = useWorkflowRun()
  const [isHovering, setIsHovering] = useState(false)
  const [open, setOpen] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)

  const formatTime = (time: number) => dayjs.unix(time).format('YYYY-MM-DD HH:mm')
  const formattedVersion = formatVersion(item.version, curIdx, page)
  const isSelected = item.version === currentVersion?.version
  const isDraft = formattedVersion === WorkflowVersion.Draft
  const isLatest = formattedVersion === WorkflowVersion.Latest

  useEffect(() => {
    if (isDraft)
      onClick(item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClickItem = () => {
    if (isSelected)
      return
    onClick(item)
  }

  const handleClickMenuItem = useCallback((operation: VersionHistoryContextMenuOptions) => {
    switch (operation) {
      case VersionHistoryContextMenuOptions.restore:
        onClick(item)
        setRestoreConfirmOpen(true)
        break
      case VersionHistoryContextMenuOptions.edit:
        setEditModalOpen(true)
        break
      case VersionHistoryContextMenuOptions.delete:
        setDeleteConfirmOpen(true)
        break
    }
  }, [onClick, item])

  const handleCancel = useCallback((operation: VersionHistoryContextMenuOptions) => {
    switch (operation) {
      case VersionHistoryContextMenuOptions.restore:
        setRestoreConfirmOpen(false)
        break
      case VersionHistoryContextMenuOptions.edit:
        setEditModalOpen(false)
        break
      case VersionHistoryContextMenuOptions.delete:
        setDeleteConfirmOpen(false)
        break
    }
  }, [])

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory(appDetail!.id)

  const handleRestore = useCallback(() => {
    setShowWorkflowVersionHistoryPanel(false)
    handleRestoreFromPublishedWorkflow(item)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })
    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('workflow.versionHistory.action.restoreSuccess'),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('workflow.versionHistory.action.restoreFailure'),
        })
      },
      onSettled: () => {
        resetWorkflowVersionHistory()
      },
    })
  }, [setShowWorkflowVersionHistoryPanel, handleSyncWorkflowDraft, workflowStore, item, handleRestoreFromPublishedWorkflow, resetWorkflowVersionHistory, t])

  const { mutateAsync: deleteWorkflow } = useDeleteWorkflow(appDetail!.id)

  const handleDelete = useCallback(async () => {
    await deleteWorkflow(item.id, {
      onSuccess: () => {
        setDeleteConfirmOpen(false)
        Toast.notify({
          type: 'success',
          message: t('workflow.versionHistory.action.deleteSuccess'),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('workflow.versionHistory.action.deleteFailure'),
        })
      },
      onSettled: () => {
        setDeleteConfirmOpen(false)
      },
    })
  }, [item, t, deleteWorkflow])

  const { mutateAsync: updateWorkflow } = useUpdateWorkflow(appDetail!.id)

  const handleUpdateWorkflow = useCallback(async (params: { title: string, releaseNotes: string }) => {
    await updateWorkflow({
      workflowId: item.id,
      ...params,
    }, {
      onSuccess: () => {
        setEditModalOpen(false)
        Toast.notify({
          type: 'success',
          message: t('workflow.versionHistory.action.updateSuccess'),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('workflow.versionHistory.action.updateFailure'),
        })
      },
      onSettled: () => {
        setEditModalOpen(false)
      },
    })
  }, [item, t, updateWorkflow])

  return (
    <>
      <div
        className={cn(
          'flex gap-x-1 relative p-2 rounded-lg group',
          isSelected ? 'bg-state-accent-active cursor-not-allowed' : 'hover:bg-state-base-hover cursor-pointer',
        )}
        onClick={handleClickItem}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false)
          setOpen(false)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
      >
        {!isLast && <div className='absolute w-0.5 h-[calc(100%-0.75rem)] left-4 top-6 bg-divider-subtle' />}
        <div className=' flex items-center justify-center shrink-0 w-[18px] h-5'>
          <div className={cn(
            'w-2 h-2 border-[2px] rounded-lg',
            isSelected ? 'border-text-accent' : 'border-text-quaternary',
          )}/>
        </div>
        <div className='flex flex-col gap-y-0.5 overflow-hidden'>
          <div className='flex items-center gap-x-1 h-5 mr-6'>
            <div className={cn(
              'py-[1px] system-sm-semibold truncate',
              isSelected ? 'text-text-accent' : 'text-text-secondary',
            )}>
              {isDraft ? t('workflow.versionHistory.currentDraft') : item.marked_name || t('workflow.versionHistory.defaultName')}
            </div>
            {isLatest && (
              <div className='flex items-center shrink-0 h-5 px-[5px] rounded-md border border-text-accent-secondary
            bg-components-badge-bg-dimm text-text-accent-secondary system-2xs-medium-uppercase'>
                {t('workflow.versionHistory.latest')}
              </div>
            )}
          </div>
          {
            !isDraft && (
              <div className='text-text-secondary system-xs-regular break-words'>
                {item.marked_comment || ''}
              </div>
            )
          }
          {
            !isDraft && (
              <div className='text-text-tertiary system-xs-regular truncate'>
                {`${formatTime(item.created_at)} · ${item.created_by.name}`}
              </div>
            )
          }
        </div>
        {/* Context Menu */}
        {!isDraft && isHovering && (
          <div className='absolute right-1 top-1'>
            <ContextMenu
              isShowDelete={!isLatest}
              isNamedVersion={!!item.marked_name}
              open={open}
              setOpen={setOpen}
              handleClickMenuItem={handleClickMenuItem}
            />
          </div>
        )}
      </div>
      {restoreConfirmOpen && (<RestoreConfirmModal
        isOpen={restoreConfirmOpen}
        versionInfo={item}
        onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.restore)}
        onRestore={handleRestore}
      />)}
      {deleteConfirmOpen && (<DeleteConfirmModal
        isOpen={deleteConfirmOpen}
        versionInfo={item}
        onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.delete)}
        onDelete={handleDelete}
      />)}
      {editModalOpen && (<VersionInfoModal
        isOpen={editModalOpen}
        versionInfo={item}
        onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.edit)}
        onPublish={handleUpdateWorkflow}
      />)}
    </>
  )
}

export default React.memo(VersionHistoryItem)
