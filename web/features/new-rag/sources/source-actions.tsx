'use client'

import type { SourceAction, SourceEditValues } from './source-list-model'
import type { Source } from './source-models'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { useKnowledgeSpacePermission } from '../space/context'
import { SourceEditDialog } from './source-edit-dialog'
import { createIdempotencyKey, getOpenableSourceUri } from './source-list-model'
import {
  initialSourceWorkflowId,
  sourceAsyncImportWorkflowId,
  sourceDisplayStatus,
  sourceFromApi,
  sourceStatusWithSyncWorkflow,
  sourceWorkflowFromApi,
  sourceWorkflowIsActive,
} from './source-models'
import {
  acceptSourceSnapshotAtom,
  removeSourceFromListAtom,
  sourcesKnowledgeSpaceIdAtom,
} from './state'

export function SourceActions({
  ensureModelSetupReady,
  source,
}: {
  ensureModelSetupReady: () => Promise<boolean>
  source: Source
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(sourcesKnowledgeSpaceIdAtom)
  const acceptSourceSnapshot = useSetAtom(acceptSourceSnapshotAtom)
  const removeSourceFromList = useSetAtom(removeSourceFromListAtom)
  const canManageSources = useKnowledgeSpacePermission('knowledge_space_document_write')
  const [pendingAction, setPendingAction] = useState<SourceAction>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const syncWorkflow = source.syncWorkflow
  const displayStatus = sourceDisplayStatus(source)
  const initializing = displayStatus === 'initializing'
  const initialWorkflowId = initialSourceWorkflowId(source)
  const initialImportRetrying = Boolean(initialWorkflowId) && displayStatus === 'syncing'
  const canEdit = canManageSources && !initializing && !initialWorkflowId
  const canRemove = canManageSources && !initializing && !initialImportRetrying
  const canSync = canManageSources && !initializing && displayStatus !== 'syncing'
  const canToggle = canManageSources && !initializing && !initialWorkflowId
  const syncAction = displayStatus === 'error' ? 'retry' : 'sync'
  const sourceUri = getOpenableSourceUri(source.uri)

  const runAction = async <Result,>(
    action: SourceAction,
    mutation: () => Promise<Result>,
    onAccepted?: (result: Result) => void,
    beforeAction?: () => Promise<boolean>,
  ) => {
    if (pendingAction) return false
    setPendingAction(action)
    try {
      if (beforeAction && !(await beforeAction())) return false
      let result: Result
      try {
        result = await mutation()
      } catch {
        toast.error(t(($) => $.sourcesErrorDescription))
        try {
          await queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          })
        } catch {
          return false
        }
        return false
      }
      onAccepted?.(result)

      try {
        await queryClient.invalidateQueries(
          {
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          },
          { throwOnError: true },
        )
      } catch {
        // The accepted mutation is already reflected by the feature graph.
      }
      return true
    } finally {
      setPendingAction(undefined)
    }
  }

  const applyAcceptedWorkflow = (workflow: Parameters<typeof sourceWorkflowFromApi>[0]) => {
    const run = sourceWorkflowFromApi(workflow)
    acceptSourceSnapshot({
      ...source,
      syncWorkflow: run,
      status: sourceStatusWithSyncWorkflow(source.status, run),
    })
  }

  const syncSource = () =>
    runAction(
      'sync',
      () =>
        consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post({
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
        }),
      applyAcceptedWorkflow,
      ensureModelSetupReady,
    )

  const retrySource = () => {
    const retryWorkflowId =
      initialWorkflowId ?? sourceAsyncImportWorkflowId(source) ?? syncWorkflow?.id
    if (!retryWorkflowId) return syncSource()

    return runAction(
      'sync',
      () =>
        consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post({
          params: { control_space_id: knowledgeSpaceId, run_id: retryWorkflowId },
        }),
      applyAcceptedWorkflow,
      ensureModelSetupReady,
    )
  }

  const toggleSource = () =>
    runAction(
      'toggle',
      async () =>
        sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
            body: {
              ...(source.version === undefined ? {} : { expectedVersion: source.version }),
              status: source.status === 'disabled' ? 'active' : 'disabled',
            },
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          }),
        ),
      (updatedSource) => {
        const nextSyncWorkflow =
          updatedSource.syncWorkflow ??
          (sourceWorkflowIsActive(source.syncWorkflow) ? source.syncWorkflow : undefined)
        acceptSourceSnapshot({
          ...updatedSource,
          lastSyncedAt: updatedSource.lastSyncedAt ?? source.lastSyncedAt,
          status: sourceStatusWithSyncWorkflow(updatedSource.status, nextSyncWorkflow),
          syncWorkflow: nextSyncWorkflow,
          syncPolicy: updatedSource.syncPolicy ?? source.syncPolicy,
        })
      },
    )

  const editSource = (values: SourceEditValues) =>
    runAction(
      'edit',
      async () =>
        sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
            body: values,
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          }),
          { useResponseStatus: true },
        ),
      acceptSourceSnapshot,
    )

  const removeSource = () =>
    runAction(
      'remove',
      async () => {
        if (source.version === undefined) throw new Error('Source version is required')
        return consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete({
          body: { expectedRevision: source.version },
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          query: { documents: 'keep' },
        })
      },
      () => removeSourceFromList(source.id),
    )

  const openEditDialog = () => {
    setMenuOpen(false)
    setEditDialogOpen(true)
  }

  if (!canEdit && !canRemove && !canSync && !canToggle && !sourceUri) return null

  return (
    <>
      {canSync && displayStatus === 'error' && (
        <Button
          className="@min-[768px]/knowledge-content:hidden @min-[1280px]/knowledge-content:inline-flex"
          size="small"
          variant="secondary"
          loading={pendingAction === 'sync'}
          disabled={Boolean(pendingAction)}
          onClick={() => void retrySource()}
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t(($) => $.sourceActions, { name: source.name })}
          disabled={Boolean(pendingAction)}
          className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          <span
            aria-hidden
            className={cn(
              'size-4.5',
              pendingAction ? 'i-ri-loader-4-line animate-spin' : 'i-ri-more-fill',
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-50">
          {canSync && (
            <DropdownMenuItem
              onClick={() => void (syncAction === 'retry' ? retrySource() : syncSource())}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-refresh-line size-4" />
              {syncAction === 'retry' ? tCommon(($) => $['operation.retry']) : t(($) => $.syncNow)}
            </DropdownMenuItem>
          )}
          {sourceUri && (
            <DropdownMenuLinkItem
              render={
                <a
                  aria-label={t(($) => $.openSource)}
                  href={sourceUri}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-external-link-line size-4" />
              {t(($) => $.openSource)}
            </DropdownMenuLinkItem>
          )}
          {canEdit && (
            <DropdownMenuItem
              onClick={openEditDialog}
              className="mb-px h-7 gap-2 px-2 system-sm-medium"
            >
              <span aria-hidden className="i-ri-edit-line size-4" />
              {tCommon(($) => $['operation.edit'])}
            </DropdownMenuItem>
          )}
          {canToggle && (
            <DropdownMenuItem
              onClick={() => void toggleSource()}
              className="h-7 gap-2 px-2 system-sm-medium"
            >
              <span
                aria-hidden
                className={cn(
                  'size-4',
                  source.status === 'disabled'
                    ? 'i-ri-checkbox-circle-line'
                    : 'i-ri-indeterminate-circle-line',
                )}
              />
              {source.status === 'disabled'
                ? t(($) => $.enable, { ns: 'dataset' })
                : t(($) => $.disableSource)}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <>
              {(canEdit || canSync || canToggle || sourceUri) && (
                <DropdownMenuSeparator className="my-px" />
              )}
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setRemoveDialogOpen(true)
                }}
                variant="destructive"
                className="h-7 gap-2 px-2 system-sm-medium"
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $.removeSource)}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SourceEditDialog
        controlSpaceId={knowledgeSpaceId}
        onEdit={editSource}
        onOpenChange={setEditDialogOpen}
        open={editDialogOpen}
        pending={pendingAction === 'edit'}
        source={source}
      />
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={pendingAction === 'remove'}
              onClick={() =>
                void removeSource().then((removed) => {
                  if (removed) setRemoveDialogOpen(false)
                })
              }
            >
              {t(($) => $.removeSource)}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
