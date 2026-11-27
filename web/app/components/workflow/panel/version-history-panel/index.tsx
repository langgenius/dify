'use client'

import type { WorkflowVersionListItem } from '@/service/workflow-queries'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Separator } from '@langgenius/dify-ui/separator'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import VersionInfoModal from '@/app/components/app/app-publisher/version-info-modal'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { getWorkflowVersionName } from '@/app/components/workflow/utils/version'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { useDeleteWorkflow, useUpdateWorkflow } from '@/service/use-workflow'
import {
  lastRunQueryKey,
  restoreWorkflowMutationOptions,
  workflowVersionHistoryInfiniteOptions,
  workflowVersionHistoryKey,
} from '@/service/workflow-queries'
import { getErrorMessage } from '@/utils/error-message'
import { useHooksStore } from '../../hooks-store'
import { useDSL } from '../../hooks/use-DSL'
import { useWorkflowRefreshDraft } from '../../hooks/use-workflow-refresh-draft'
import { useWorkflowRun } from '../../hooks/use-workflow-run'
import { useStore, useWorkflowStore } from '../../store'
import {
  VersionHistoryContextMenuOptions,
  WorkflowVersion,
  WorkflowVersionFilterOptions,
} from '../../types'
import DeleteConfirmModal from './delete-confirm-modal'
import Empty from './empty'
import Filter from './filter'
import Loading from './loading'
import RestoreConfirmModal from './restore-confirm-modal'
import VersionHistoryItem from './version-history-item'

const HISTORY_PER_PAGE = 10

export type VersionHistoryPanelProps = {
  latestVersionId?: string
}

export const VersionHistoryPanel = ({ latestVersionId }: VersionHistoryPanelProps) => {
  const [filterValue, setFilterValue] = useState<WorkflowVersionFilterOptions>(
    WorkflowVersionFilterOptions.all,
  )
  const [isOnlyShowNamedVersions, setIsOnlyShowNamedVersions] = useState(false)
  const [operatedItem, setOperatedItem] = useState<WorkflowVersionListItem>()
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [isRestorePlanUpgradeModalOpen, setIsRestorePlanUpgradeModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const isPlanUnavailable = deploymentEdition === 'CLOUD' && plan === undefined
  const workflowStore = useWorkflowStore()
  const { handleRestoreFromPublishedWorkflow, handleLoadBackupDraft } = useWorkflowRun()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const { handleExportDSL } = useDSL()
  const setShowWorkflowVersionHistoryPanel = useStore((s) => s.setShowWorkflowVersionHistoryPanel)
  const currentVersion = useStore((s) => s.currentVersion)
  const setCurrentVersion = useStore((s) => s.setCurrentVersion)
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const resource = useAtomValue(editorResourceAtom)
  const canImportExportDSL = useHooksStore((s) => s.accessControl.canImportExportDSL)
  const queryClient = useQueryClient()
  const invalidAllLastRun = useCallback(
    () => queryClient.invalidateQueries({ queryKey: lastRunQueryKey(resource) }),
    [queryClient, resource],
  )
  const { deleteAllInspectVars } = workflowStore.getState()
  const { t } = useTranslation(['billing', 'common', 'workflow', 'workflowHistory'])

  const versionHistoryQuery = useInfiniteQuery(
    workflowVersionHistoryInfiniteOptions(resource, {
      limit: HISTORY_PER_PAGE,
      userId: filterValue === WorkflowVersionFilterOptions.onlyYours ? userProfile.id : '',
      namedOnly: isOnlyShowNamedVersions,
    }),
  )

  const { data: versionHistory, fetchNextPage, hasNextPage, isFetching } = versionHistoryQuery
  const versionHistoryLoad = useOwnedQueryError(versionHistoryQuery)
  const versionHistoryErrorMessage = useRequestErrorMessage(
    versionHistoryLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )

  // Showing the draft inside the history session loads the backup but keeps it, so the draft can be
  // shown again after previewing or deleting another version. Leaving history clears it.
  const showBackupDraft = useCallback(() => {
    const { backupDraft } = workflowStore.getState()
    handleLoadBackupDraft()
    if (backupDraft) workflowStore.setState({ backupDraft })
  }, [workflowStore, handleLoadBackupDraft])

  // The draft is selected when the panel opens. Remember it for the session, since the list
  // filters (named versions only, only yours) can leave it out of the list later.
  const draftVersionRef = useRef<WorkflowVersionListItem | null>(null)

  const handleVersionClick = useCallback(
    (item: WorkflowVersionListItem) => {
      if (item.version === WorkflowVersion.Draft) draftVersionRef.current = item
      if (item.id !== currentVersion?.id) {
        setCurrentVersion(item)
        if (item.version === WorkflowVersion.Draft) showBackupDraft()
        else handleRestoreFromPublishedWorkflow(item)
      }
    },
    [currentVersion?.id, setCurrentVersion, showBackupDraft, handleRestoreFromPublishedWorkflow],
  )

  const handleNextPage = () => {
    if (hasNextPage) fetchNextPage()
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

  const handleClickActionMenuItem = useCallback(
    (item: WorkflowVersionListItem, operation: VersionHistoryContextMenuOptions) => {
      if (operation === VersionHistoryContextMenuOptions.delete && item.environments?.length) {
        toast.error(
          t(($) => $['versionHistory.action.deleteDeployedVersionError'], {
            ns: 'workflowHistory',
          }),
        )
        return
      }

      setOperatedItem(item)
      switch (operation) {
        case VersionHistoryContextMenuOptions.restore:
          if (isPlanUnavailable) return
          if (deploymentEdition === 'CLOUD' && plan === 'sandbox') {
            setIsRestorePlanUpgradeModalOpen(true)
            break
          }
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
          toast.success(
            t(($) => $['versionHistory.action.copyIdSuccess'], { ns: 'workflowHistory' }),
          )
          break
        case VersionHistoryContextMenuOptions.exportDSL:
          if (isPlanUnavailable) return
          if (deploymentEdition === 'CLOUD' && plan === 'sandbox') {
            setIsRestorePlanUpgradeModalOpen(true)
            break
          }
          if (!canImportExportDSL) return
          handleExportDSL?.(false, item.id)
          break
      }
    },
    [isPlanUnavailable, deploymentEdition, plan, canImportExportDSL, t, handleExportDSL],
  )

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

  const emitRestoreIntent = useCallback(
    async (item: WorkflowVersionListItem) => {
      try {
        const { collaborationManager } =
          await import('../../collaboration/core/collaboration-manager')
        collaborationManager.emitRestoreIntent({
          versionId: item.id,
          versionName: getWorkflowVersionName(
            item,
            t(($) => $['versionHistory.defaultName'], { ns: 'workflowHistory' }),
          ),
          initiatorUserId: userProfile.id,
          initiatorName: userProfile.name,
        })
      } catch (error) {
        console.error('Failed to emit restore intent:', error)
      }
    },
    [t, userProfile.id, userProfile.name],
  )

  const emitRestoreComplete = useCallback(
    async (item: WorkflowVersionListItem, success: boolean, errorMessage?: string) => {
      try {
        const { collaborationManager } =
          await import('../../collaboration/core/collaboration-manager')
        collaborationManager.emitRestoreComplete({
          versionId: item.id,
          success,
          ...(errorMessage ? { error: errorMessage } : {}),
        })
      } catch (error) {
        console.error('Failed to emit restore complete:', error)
      }
    },
    [],
  )

  const emitWorkflowUpdate = useCallback(async () => {
    try {
      if (resource.kind !== 'app') return
      const { appId } = resource

      const { collaborationManager } =
        await import('../../collaboration/core/collaboration-manager')
      collaborationManager.emitWorkflowUpdate(appId)
    } catch (error) {
      console.error('Failed to emit workflow update:', error)
    }
  }, [resource])

  const resetWorkflowVersionHistory = useCallback(
    () => queryClient.resetQueries({ queryKey: workflowVersionHistoryKey(resource) }),
    [queryClient, resource],
  )
  const { mutateAsync: restoreWorkflow } = useMutation(restoreWorkflowMutationOptions(resource))

  const handleRestore = useCallback(
    async (item: WorkflowVersionListItem) => {
      setShowWorkflowVersionHistoryPanel(false)
      await emitRestoreIntent(item)

      try {
        await restoreWorkflow(item.id)
        setCurrentVersion(item)
        workflowStore.setState({ isRestoring: false })
        workflowStore.setState({ backupDraft: undefined })
        handleRefreshWorkflowDraft()
        toast.success(
          t(($) => $['versionHistory.action.restoreSuccess'], { ns: 'workflowHistory' }),
        )
        deleteAllInspectVars()
        invalidAllLastRun()
        await emitRestoreComplete(item, true)
        await emitWorkflowUpdate()
      } catch (error) {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['versionHistory.action.restoreFailure'], { ns: 'workflowHistory' }),
        )
        await emitRestoreComplete(item, false, 'restore failed')
      } finally {
        resetWorkflowVersionHistory()
      }
    },
    [
      setShowWorkflowVersionHistoryPanel,
      emitRestoreIntent,
      restoreWorkflow,
      setCurrentVersion,
      workflowStore,
      handleRefreshWorkflowDraft,
      t,
      deleteAllInspectVars,
      invalidAllLastRun,
      emitRestoreComplete,
      emitWorkflowUpdate,
      resetWorkflowVersionHistory,
    ],
  )

  const deleteWorkflow = useDeleteWorkflow(resource)

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        // The generated delete mutation resets the version list.
        await deleteWorkflow(id)
        // A deleted version can no longer be previewed or restored: go back to the draft. Read the
        // selection now, since it can change while the delete request is in flight.
        if (workflowStore.getState().currentVersion?.id === id) {
          workflowStore.setState({ currentVersion: draftVersionRef.current })
          showBackupDraft()
        }
        deleteAllInspectVars()
        invalidAllLastRun()
      } catch (error) {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['versionHistory.action.deleteFailure'], { ns: 'workflowHistory' }),
        )
      } finally {
        setDeleteConfirmOpen(false)
      }
    },
    [deleteWorkflow, t, deleteAllInspectVars, invalidAllLastRun, workflowStore, showBackupDraft],
  )

  const { mutateAsync: updateWorkflow } = useUpdateWorkflow()

  const handleUpdateWorkflow = useCallback(
    async (params: { id?: string; title: string; releaseNotes: string }) => {
      const { id, ...rest } = params
      if (!id) return
      try {
        await updateWorkflow({ resource, versionId: id, ...rest })
      } catch (error) {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['versionHistory.action.updateFailure'], { ns: 'workflowHistory' }),
        )
      } finally {
        setEditModalOpen(false)
      }
    },
    [resource, t, updateWorkflow],
  )

  return (
    <div className="flex h-full w-67 flex-col rounded-s-2xl border-y-[0.5px] border-s-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-center gap-x-2 px-4 pt-3">
        <div className="flex-1 py-1 system-xl-semibold text-text-primary">
          {t(($) => $['versionHistory.title'], { ns: 'workflowHistory' })}
        </div>
        <Filter
          filterValue={filterValue}
          isOnlyShowNamedVersions={isOnlyShowNamedVersions}
          onClickFilterItem={handleClickFilterItem}
          handleSwitch={handleSwitch}
        />
        <Separator decorative orientation="vertical" className="mx-1 h-3.5" />
        <button
          type="button"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="flex size-6 cursor-pointer items-center justify-center rounded p-0.5 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={handleClose}
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </button>
      </div>
      <div className="flex h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isFetching && !versionHistory?.pages?.length ? (
            <Loading />
          ) : versionHistoryLoad ? (
            <Alert type="error">
              <AlertTitle>{versionHistoryErrorMessage}</AlertTitle>
              <AlertActions>
                <Button size="small" variant="secondary" onClick={versionHistoryLoad.retry}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
          ) : (
            <>
              {versionHistory?.pages?.map((page, pageNumber) =>
                page.items?.map((item, idx) => {
                  const isLast =
                    pageNumber === versionHistory.pages.length - 1 && idx === page.items.length - 1
                  return (
                    <VersionHistoryItem
                      key={item.id}
                      item={item}
                      currentVersion={currentVersion}
                      latestVersionId={latestVersionId || ''}
                      onClick={handleVersionClick}
                      handleClickActionMenuItem={handleClickActionMenuItem.bind(null, item)}
                      canImportExportDSL={canImportExportDSL}
                      isLast={isLast}
                    />
                  )
                }),
              )}
              {!isFetching &&
                (!versionHistory?.pages?.length || !versionHistory.pages[0]!.items.length) && (
                  <Empty onResetFilter={handleResetFilter} />
                )}
            </>
          )}
        </div>
        {hasNextPage && (
          <div className="p-2">
            <button
              type="button"
              aria-busy={isFetching || undefined}
              className="flex w-full cursor-pointer items-center gap-x-1 rounded outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-wait"
              disabled={isFetching}
              onClick={handleNextPage}
            >
              <span className="flex items-center justify-center p-0.5">
                {isFetching ? (
                  <span
                    aria-hidden
                    className="i-ri-loader-2-line size-3.5 animate-spin text-text-accent motion-reduce:animate-none"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="i-ri-arrow-down-double-line size-3.5 text-text-accent"
                  />
                )}
              </span>
              <span className="py-px system-xs-medium-uppercase text-text-accent">
                {t(($) => $['common.loadMore'], { ns: 'workflow' })}
              </span>
            </button>
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
      {isRestorePlanUpgradeModalOpen && (
        <PlanUpgradeModal
          show
          onClose={() => setIsRestorePlanUpgradeModalOpen(false)}
          title={t(($) => $['upgrade.workflowRestore.title'], { ns: 'billing' })!}
          description={t(($) => $['upgrade.workflowRestore.description'], { ns: 'billing' })!}
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
