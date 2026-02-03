'use client'
import type { VersionHistory } from '@/types/workflow'
import { RiArrowDownDoubleLine, RiCloseLine, RiLoader2Line } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import VersionInfoModal from '@/app/components/app/app-publisher/version-info-modal'
import Divider from '@/app/components/base/divider'
import Toast from '@/app/components/base/toast'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useDeleteWorkflow, useInvalidAllLastRun, useResetWorkflowVersionHistory, useUpdateWorkflow, useWorkflowVersionHistory } from '@/service/use-workflow'
import { useDSL, useNodesSyncDraft, useWorkflowRun } from '../../hooks'
import { useHooksStore } from '../../hooks-store'
import { useStore, useWorkflowStore } from '../../store'
import { VersionHistoryContextMenuOptions, WorkflowVersion, WorkflowVersionFilterOptions } from '../../types'
import DeleteConfirmModal from './delete-confirm-modal'
import Empty from './empty'
import Filter from './filter'
import Loading from './loading'
import RestoreConfirmModal from './restore-confirm-modal'
import VersionHistoryItem from './version-history-item'

const HISTORY_PER_PAGE = 10
const INITIAL_PAGE = 1

export type VersionHistoryPanelProps = {
  getVersionListUrl?: string
  deleteVersionUrl?: (versionId: string) => string
  updateVersionUrl?: (versionId: string) => string
  latestVersionId?: string
}
export const VersionHistoryPanel = ({
  getVersionListUrl,
  deleteVersionUrl,
  updateVersionUrl,
  latestVersionId,
}: VersionHistoryPanelProps) => {
  const [filterValue, setFilterValue] = useState(WorkflowVersionFilterOptions.all)
  const [isOnlyShowNamedVersions, setIsOnlyShowNamedVersions] = useState(false)
  const [operatedItem, setOperatedItem] = useState<VersionHistory>()
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const workflowStore = useWorkflowStore()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleRestoreFromPublishedWorkflow, handleLoadBackupDraft } = useWorkflowRun()
  const { handleExportDSL } = useDSL()
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)
  const currentVersion = useStore(s => s.currentVersion)
  const setCurrentVersion = useStore(s => s.setCurrentVersion)
  const userProfile = useAppContextSelector(s => s.userProfile)
  const configsMap = useHooksStore(s => s.configsMap)
  const invalidAllLastRun = useInvalidAllLastRun(configsMap?.flowType, configsMap?.flowId)
  const {
    deleteAllInspectVars,
  } = workflowStore.getState()
  const { t } = useTranslation()

  const {
    data: versionHistory,
    fetchNextPage,
    hasNextPage,
    isFetching,
  } = useWorkflowVersionHistory({
    url: getVersionListUrl || '',
    initialPage: INITIAL_PAGE,
    limit: HISTORY_PER_PAGE,
    userId: filterValue === WorkflowVersionFilterOptions.onlyYours ? userProfile.id : '',
    namedOnly: isOnlyShowNamedVersions,
  })

  const handleVersionClick = useCallback((item: VersionHistory) => {
    if (item.id !== currentVersion?.id) {
      setCurrentVersion(item)
      if (item.version === WorkflowVersion.Draft)
        handleLoadBackupDraft()
      else
        handleRestoreFromPublishedWorkflow(item)
    }
  }, [currentVersion?.id, setCurrentVersion, handleLoadBackupDraft, handleRestoreFromPublishedWorkflow])

  const handleNextPage = () => {
    if (hasNextPage)
      fetchNextPage()
  }

  const handleClose = () => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }

  const handleClickFilterItem = useCallback((value: WorkflowVersionFilterOptions) => {
    setFilterValue(value)
  }, [])

  const handleSwitch = useCallback((value: boolean) => {
    setIsOnlyShowNamedVersions(value)
  }, [])

  const handleResetFilter = useCallback(() => {
    setFilterValue(WorkflowVersionFilterOptions.all)
    setIsOnlyShowNamedVersions(false)
  }, [])

  const handleClickMenuItem = useCallback((item: VersionHistory, operation: VersionHistoryContextMenuOptions) => {
    setOperatedItem(item)
    switch (operation) {
      case VersionHistoryContextMenuOptions.restore:
        setRestoreConfirmOpen(true)
        break
      case VersionHistoryContextMenuOptions.edit:
        setEditModalOpen(true)
        break
      case VersionHistoryContextMenuOptions.delete:
        setDeleteConfirmOpen(true)
        break
      case VersionHistoryContextMenuOptions.copyId:
        copy(item.id)
        Toast.notify({
          type: 'success',
          message: t('versionHistory.action.copyIdSuccess', { ns: 'workflow' }),
        })
        break
      case VersionHistoryContextMenuOptions.exportDSL:
        handleExportDSL?.(false, item.id)
        break
    }
  }, [t, handleExportDSL])

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

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()

  const handleRestore = useCallback((item: VersionHistory) => {
    setShowWorkflowVersionHistoryPanel(false)
    handleRestoreFromPublishedWorkflow(item)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })
    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('versionHistory.action.restoreSuccess', { ns: 'workflow' }),
        })
        deleteAllInspectVars()
        invalidAllLastRun()
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('versionHistory.action.restoreFailure', { ns: 'workflow' }),
        })
      },
      onSettled: () => {
        resetWorkflowVersionHistory()
      },
    })
  }, [setShowWorkflowVersionHistoryPanel, handleRestoreFromPublishedWorkflow, workflowStore, handleSyncWorkflowDraft, deleteAllInspectVars, invalidAllLastRun, t, resetWorkflowVersionHistory])

  const { mutateAsync: deleteWorkflow } = useDeleteWorkflow()

  const handleDelete = useCallback(async (id: string) => {
    await deleteWorkflow(deleteVersionUrl?.(id) || '', {
      onSuccess: () => {
        setDeleteConfirmOpen(false)
        Toast.notify({
          type: 'success',
          message: t('versionHistory.action.deleteSuccess', { ns: 'workflow' }),
        })
        resetWorkflowVersionHistory()
        deleteAllInspectVars()
        invalidAllLastRun()
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('versionHistory.action.deleteFailure', { ns: 'workflow' }),
        })
      },
      onSettled: () => {
        setDeleteConfirmOpen(false)
      },
    })
  }, [deleteWorkflow, t, resetWorkflowVersionHistory, deleteAllInspectVars, invalidAllLastRun, deleteVersionUrl])

  const { mutateAsync: updateWorkflow } = useUpdateWorkflow()

  const handleUpdateWorkflow = useCallback(async (params: { id?: string, title: string, releaseNotes: string }) => {
    const { id, ...rest } = params
    await updateWorkflow({
      url: updateVersionUrl?.(id || '') || '',
      ...rest,
    }, {
      onSuccess: () => {
        setEditModalOpen(false)
        Toast.notify({
          type: 'success',
          message: t('versionHistory.action.updateSuccess', { ns: 'workflow' }),
        })
        resetWorkflowVersionHistory()
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('versionHistory.action.updateFailure', { ns: 'workflow' }),
        })
      },
      onSettled: () => {
        setEditModalOpen(false)
      },
    })
  }, [t, updateWorkflow, resetWorkflowVersionHistory, updateVersionUrl])

  return (
    <div className="flex h-full w-[268px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-center gap-x-2 px-4 pt-3">
        <div className="system-xl-semibold flex-1 py-1 text-text-primary">{t('versionHistory.title', { ns: 'workflow' })}</div>
        <Filter
          filterValue={filterValue}
          isOnlyShowNamedVersions={isOnlyShowNamedVersions}
          onClickFilterItem={handleClickFilterItem}
          handleSwitch={handleSwitch}
        />
        <Divider type="vertical" className="mx-1 h-3.5" />
        <div
          className="flex h-6 w-6 cursor-pointer items-center justify-center p-0.5"
          onClick={handleClose}
        >
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </div>
      </div>
      <div className="flex h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {(isFetching && !versionHistory?.pages?.length)
            ? (
                <Loading />
              )
            : (
                <>
                  {versionHistory?.pages?.map((page, pageNumber) => (
                    page.items?.map((item, idx) => {
                      const isLast = pageNumber === versionHistory.pages.length - 1 && idx === page.items.length - 1
                      return (
                        <VersionHistoryItem
                          key={item.id}
                          item={item}
                          currentVersion={currentVersion}
                          latestVersionId={latestVersionId || ''}
                          onClick={handleVersionClick}
                          handleClickMenuItem={handleClickMenuItem.bind(null, item)}
                          isLast={isLast}
                        />
                      )
                    })
                  ))}
                  {!isFetching && (!versionHistory?.pages?.length || !versionHistory.pages[0].items.length) && (
                    <Empty onResetFilter={handleResetFilter} />
                  )}
                </>
              )}
        </div>
        {hasNextPage && (
          <div className="p-2">
            <div
              className="flex cursor-pointer items-center gap-x-1"
              onClick={handleNextPage}
            >
              <div className="item-center flex justify-center p-0.5">
                {isFetching
                  ? <RiLoader2Line className="h-3.5 w-3.5 animate-spin text-text-accent" />
                  : <RiArrowDownDoubleLine className="h-3.5 w-3.5 text-text-accent" />}
              </div>
              <div className="system-xs-medium-uppercase py-[1px] text-text-accent">
                {t('common.loadMore', { ns: 'workflow' })}
              </div>
            </div>
          </div>
        )}
      </div>
      {restoreConfirmOpen && (
        <RestoreConfirmModal
          isOpen={restoreConfirmOpen}
          versionInfo={operatedItem!}
          onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.restore)}
          onRestore={handleRestore}
        />
      )}
      {deleteConfirmOpen && (
        <DeleteConfirmModal
          isOpen={deleteConfirmOpen}
          versionInfo={operatedItem!}
          onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.delete)}
          onDelete={handleDelete}
        />
      )}
      {editModalOpen && (
        <VersionInfoModal
          isOpen={editModalOpen}
          versionInfo={operatedItem}
          onClose={handleCancel.bind(null, VersionHistoryContextMenuOptions.edit)}
          onPublish={handleUpdateWorkflow}
        />
      )}
    </div>
  )
}

export default React.memo(VersionHistoryPanel)
