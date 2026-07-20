'use client'

import type {
  DocumentProcessingTask,
  LogicalDocument,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import { taskCanRetry, taskIsActive } from './document-model'

type TaskAction = 'cancel' | 'retry'

function taskTime(task: DocumentProcessingTask) {
  return task.completedAt ?? task.updatedAt
}

export function ProcessingTasksDrawer({
  canEdit,
  documents,
  knowledgeSpaceId,
  onOpenChange,
  onTaskUpdated,
  open,
  taskQueryError,
  taskQueryPending,
  tasks,
  onRetryTaskQuery,
}: {
  canEdit: boolean
  documents: LogicalDocument[]
  knowledgeSpaceId: string
  onOpenChange: (open: boolean) => void
  onTaskUpdated: (task: DocumentProcessingTask) => void
  open: boolean
  taskQueryError: boolean
  taskQueryPending: boolean
  tasks: DocumentProcessingTask[]
  onRetryTaskQuery: () => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const cancelTask = useMutation(
    consoleQuery.knowledgeFs.deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId.mutationOptions(),
  )
  const retryTask = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry.mutationOptions(),
  )
  const pendingActionsRef = useRef(new Set<string>())
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, boolean>>({})
  const documentTitles = new Map(documents.map((document) => [document.id, document.title]))
  const orderedTasks = [...tasks].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
  )

  const refreshDocumentsAndTasks = () =>
    Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdLogicalDocuments.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdProcessingTasks.key(),
      }),
    ])

  const performAction = async (task: DocumentProcessingTask, action: TaskAction) => {
    if (!canEdit || pendingActionsRef.current.has(task.id)) return
    pendingActionsRef.current.add(task.id)
    setPendingActions((current) => new Set(current).add(task.id))
    setActionErrors((current) => ({ ...current, [task.id]: false }))
    try {
      const input = {
        params: {
          documentId: task.documentId,
          id: knowledgeSpaceId,
          taskId: task.id,
        },
      }
      const updated =
        action === 'cancel'
          ? await cancelTask.mutateAsync(input)
          : await retryTask.mutateAsync(input)
      onTaskUpdated(updated)
    } catch {
      setActionErrors((current) => ({ ...current, [task.id]: true }))
    } finally {
      await refreshDocumentsAndTasks()
      pendingActionsRef.current.delete(task.id)
      setPendingActions((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  return (
    <Drawer open={open} modal swipeDirection="right" onOpenChange={onOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-[440px] data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <header className="shrink-0 px-6 pt-5 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <DrawerTitle className="system-md-semibold text-text-primary">
                    {t(($) => $['newKnowledge.backgroundTasks'])}
                  </DrawerTitle>
                  <DrawerCloseButton
                    aria-label={tCommon(($) => $['operation.close'])}
                    className="size-6 rounded-md"
                  />
                </div>
                <DrawerDescription className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.backgroundTasksDescription'])}
                </DrawerDescription>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                {taskQueryError && (
                  <div className="mb-3 rounded-xl border border-divider-regular p-4" role="alert">
                    <p className="system-xs-regular text-text-destructive">
                      {t(($) => $['newKnowledge.tasksErrorDescription'])}
                    </p>
                    <Button className="mt-3" size="small" onClick={onRetryTaskQuery}>
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                )}
                {taskQueryPending && !orderedTasks.length ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Loading />
                  </div>
                ) : orderedTasks.length ? (
                  <ul className="divide-y divide-divider-subtle">
                    {orderedTasks.map((task) => {
                      const title = documentTitles.get(task.documentId) ?? task.documentId
                      const timestamp = Date.parse(
                        taskIsActive(task) ? task.createdAt : taskTime(task),
                      )
                      const taskError = task.errorMessage ?? task.errorCode
                      return (
                        <li key={task.id} className="flex min-h-[62px] items-center gap-2.5 py-3.5">
                          <span
                            aria-hidden
                            className={
                              task.state === 'failed'
                                ? 'i-ri-error-warning-fill size-4 shrink-0 text-text-destructive'
                                : taskIsActive(task)
                                  ? 'i-ri-loader-2-line size-4 shrink-0 animate-spin text-text-accent motion-reduce:animate-none'
                                  : task.state === 'succeeded'
                                    ? 'i-ri-check-line size-4 shrink-0 text-text-success'
                                    : 'i-ri-indeterminate-circle-line size-4 shrink-0 text-text-tertiary'
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate system-xs-medium text-text-primary">
                              {t(($) => $['newKnowledge.processDocument'], { name: title })}
                            </p>
                            <p className="mt-0.5 truncate system-2xs-regular text-text-tertiary">
                              {t(($) => $[`newKnowledge.processingTaskState.${task.state}`], {
                                progress: task.progressPercent,
                              })}
                              {!Number.isNaN(timestamp) && (
                                <>
                                  <span aria-hidden> · </span>
                                  {formatTimeFromNow(timestamp)}
                                </>
                              )}
                            </p>
                            {taskError && (
                              <p className="mt-1 truncate system-2xs-regular text-text-destructive">
                                {taskError}
                              </p>
                            )}
                            {actionErrors[task.id] && (
                              <p
                                className="mt-1 system-2xs-regular text-text-destructive"
                                role="alert"
                              >
                                {t(($) => $['newKnowledge.taskActionFailed'])}
                              </p>
                            )}
                          </div>
                          {canEdit && taskIsActive(task) ? (
                            <Button
                              size="small"
                              disabled={pendingActions.has(task.id)}
                              loading={pendingActions.has(task.id)}
                              onClick={() => void performAction(task, 'cancel')}
                            >
                              {t(($) => $['newKnowledge.interruptTask'])}
                            </Button>
                          ) : canEdit && taskCanRetry(task) ? (
                            <Button
                              size="small"
                              disabled={pendingActions.has(task.id)}
                              loading={pendingActions.has(task.id)}
                              onClick={() => void performAction(task, 'retry')}
                            >
                              {t(($) => $['newKnowledge.retryTask'])}
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : !taskQueryError ? (
                  <p className="py-16 text-center system-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.noBackgroundTasks'])}
                  </p>
                ) : null}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
