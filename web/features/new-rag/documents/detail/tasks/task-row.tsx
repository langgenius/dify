'use client'

import type { BackgroundTask } from '../../models'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleClient } from '@/service/client'
import {
  knowledgeFsTaskFailureDetail,
  knowledgeFsTaskFailureMessageKey,
  knowledgeFsTaskRecoveryPath,
} from '../../../knowledge-fs-task-error'
import { taskCanCancel, taskCanRetry, taskIsActive } from '../../model'
import { backgroundTaskFromApi } from '../../models'
import { taskLifecycle, taskProgress, taskTime } from '../../tasks/drawer-model'
import { documentDetailKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentCanEditAtom, retryDocumentWritePermissionAtom } from '../state/workflow'
import { useRefreshDocumentWritePermission } from '../write-permission'

export const DOCUMENT_TASK_DRAWER_CLOSE_ID = 'document-task-drawer-close'

type TaskAction = 'cancel' | 'retry'

function responseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error)
    return typeof error.status === 'number' ? error.status : undefined
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

function focusDrawerCloseButton() {
  document.getElementById(DOCUMENT_TASK_DRAWER_CLOSE_ID)?.focus()
}

export function DocumentTaskRow({
  cancelActionCount,
  documentTitle,
  documentsPending,
  onSettled,
  retryActionCount,
  task,
}: {
  cancelActionCount: number
  documentTitle?: string
  documentsPending: boolean
  onSettled: () => Promise<unknown>
  retryActionCount: number
  task: BackgroundTask
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const knowledgeSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const canEdit = useAtomValue(documentCanEditAtom)
  const retryWritePermission = useSetAtom(retryDocumentWritePermissionAtom)
  const refreshWritePermission = useRefreshDocumentWritePermission()
  const actionButtonRef = useRef<HTMLButtonElement>(null)
  const currentLifecycle = taskLifecycle(task)
  const currentLifecycleRef = useRef(currentLifecycle)
  currentLifecycleRef.current = currentLifecycle
  const [failedLifecycle, setFailedLifecycle] = useState<string>()
  const cancelTask = useMutation({
    mutationFn: async () =>
      backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.cancel.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: task.id,
              task_kind: task.taskKind,
            },
          },
        ),
      ),
  })
  const retryTask = useMutation({
    mutationFn: async () =>
      backgroundTaskFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post(
          {
            params: {
              control_space_id: knowledgeSpaceId,
              task_id: task.id,
              task_kind: task.taskKind,
            },
          },
        ),
      ),
  })
  const pending = Boolean(cancelTask.isPending || retryTask.isPending)

  useLayoutEffect(
    () => () => {
      if (document.activeElement === actionButtonRef.current) focusDrawerCloseButton()
    },
    [],
  )

  const resolvedDocumentTitle =
    task.documentTitle ??
    (task.documentId
      ? (documentTitle ??
        (documentsPending ? t(($) => $['newKnowledge.documentColumn']) : task.documentId))
      : undefined)
  const operationTitle = t(($) => $[`newKnowledge.overview.operation.${task.operation}`])
  const progress = taskProgress(task)
  const title =
    task.operation === 'document_processing' && resolvedDocumentTitle
      ? `${t(($) => $['newKnowledge.addDocument'])} · ${resolvedDocumentTitle}`
      : task.operation === 'document_upload'
        ? `${t(($) => $['newKnowledge.addDocument'])}${progress ? ` · ${progress.total}` : ''}`
        : task.operation === 'document_reindex'
          ? `${t(($) => $['newKnowledge.reindexDocuments'])}${resolvedDocumentTitle ? ` · ${resolvedDocumentTitle}` : progress && progress.total > 1 ? ` · ${progress.total}` : ''}`
          : task.operation === 'document_delete' && resolvedDocumentTitle
            ? `${operationTitle} · ${resolvedDocumentTitle}`
            : progress
              ? `${operationTitle} · ${progress.total}`
              : operationTitle
  const timestamp = Date.parse(taskIsActive(task) ? task.createdAt : taskTime(task))
  const relativeTime = Number.isNaN(timestamp) ? undefined : formatTimeFromNow(timestamp)
  const progressLabel = progress
    ? progress.total > 1
      ? `${progress.completed}/${progress.total}`
      : `${task.progressPercent}%`
    : undefined
  const stateLabel = t(($) => $[`newKnowledge.processingTaskState.${task.state}`], {
    progress: task.progressPercent,
  })
  const status =
    task.state === 'queued' || task.state === 'dispatch_pending'
      ? stateLabel
      : task.state === 'running' && progressLabel
        ? `${progressLabel}${relativeTime ? ` — ${relativeTime}` : ''}`
        : task.state === 'failed' && progressLabel
          ? `${progressLabel} — ${stateLabel}${relativeTime ? ` ${relativeTime}` : ''}`
          : task.state === 'canceled' && progressLabel
            ? `${stateLabel} — ${progressLabel}`
            : task.state === 'succeeded'
              ? `${stateLabel}${relativeTime ? ` ${relativeTime}` : ''}`
              : `${stateLabel}${relativeTime ? ` · ${relativeTime}` : ''}`
  const taskFailureMessageKey = knowledgeFsTaskFailureMessageKey(
    task.failure,
    task.errorCode ?? (task.errorMessage ? 'LEGACY_TASK_FAILURE' : undefined),
  )
  const taskError = taskFailureMessageKey ? t(($) => $[taskFailureMessageKey]) : undefined
  const taskErrorDetail = knowledgeFsTaskFailureDetail(task.failure, t)
  const recoveryPath = knowledgeFsTaskRecoveryPath(task.failure, knowledgeSpaceId)
  const recoveryLabel =
    task.failure?.action === 'configure_model'
      ? tCommon(($) => $['datasetMenus.settings'])
      : task.failure?.action === 'configure_source'
        ? t(($) => $['newKnowledge.openSource'])
        : task.failure?.action === 'reupload'
          ? t(($) => $['newKnowledge.addDocument'])
          : undefined
  const actionTarget = `${title} · ${task.id}`

  async function performAction(action: TaskAction) {
    if (!canEdit || pending) return
    const actionLifecycle = currentLifecycle
    const actionFocusTarget = document.activeElement
    setFailedLifecycle(undefined)
    try {
      if (action === 'cancel') await cancelTask.mutateAsync()
      else await retryTask.mutateAsync()
      if (currentLifecycleRef.current !== actionLifecycle) return
      if (document.activeElement === actionFocusTarget) focusDrawerCloseButton()
    } catch (error) {
      const permissionDenied = responseStatus(error) === 403
      if (permissionDenied) void retryWritePermission(refreshWritePermission)
      else if (currentLifecycleRef.current === actionLifecycle) setFailedLifecycle(actionLifecycle)
    } finally {
      void onSettled()
    }
  }

  return (
    <li className="flex min-h-15.5 items-center gap-2.5 py-3.5">
      <span
        aria-hidden
        className={
          task.state === 'failed'
            ? 'i-ri-error-warning-fill size-4 shrink-0 text-text-destructive'
            : task.state === 'dispatch_pending' ||
                task.state === 'queued' ||
                task.state === 'retry_wait'
              ? 'i-ri-time-line size-4 shrink-0 text-text-tertiary'
              : taskIsActive(task)
                ? 'i-ri-loader-2-line size-4 shrink-0 animate-spin text-text-accent motion-reduce:animate-none'
                : task.state === 'succeeded'
                  ? 'i-ri-check-line size-4 shrink-0 text-text-success'
                  : 'i-ri-indeterminate-circle-line size-4 shrink-0 text-text-tertiary'
        }
      />
      <div className="min-w-0 flex-1">
        <p className="truncate system-sm-medium text-text-primary" title={title}>
          {title}
        </p>
        <p className="mt-0.75 truncate system-xs-regular text-text-tertiary" title={status}>
          {status}
        </p>
        {taskError && (
          <p className="mt-1 system-2xs-regular wrap-break-word whitespace-pre-wrap text-text-destructive">
            {taskError}
          </p>
        )}
        {taskError && taskErrorDetail && (
          <p className="mt-0.5 system-2xs-regular wrap-break-word text-text-quaternary">
            {taskErrorDetail}
          </p>
        )}
        {failedLifecycle === currentLifecycle && (
          <p className="mt-1 system-2xs-regular text-text-destructive" role="alert">
            {t(($) => $['newKnowledge.taskActionFailed'])}
          </p>
        )}
      </div>
      {canEdit && taskCanCancel(task) ? (
        <Button
          ref={actionButtonRef}
          aria-label={
            cancelActionCount > 1
              ? `${t(($) => $['newKnowledge.interruptTask'])} · ${actionTarget}`
              : undefined
          }
          size="small"
          aria-busy={pending}
          disabled={pending}
          loading={pending}
          onClick={() => void performAction('cancel')}
        >
          {t(($) => $['newKnowledge.interruptTask'])}
        </Button>
      ) : canEdit && taskCanRetry(task) ? (
        <Button
          ref={actionButtonRef}
          aria-label={
            retryActionCount > 1
              ? `${t(($) => $['newKnowledge.retryTask'])} · ${actionTarget}`
              : undefined
          }
          size="small"
          aria-busy={pending}
          disabled={pending}
          loading={pending}
          onClick={() => void performAction('retry')}
        >
          {t(($) => $['newKnowledge.retryTask'])}
        </Button>
      ) : canEdit && recoveryPath && recoveryLabel ? (
        <Link
          aria-label={`${recoveryLabel} · ${actionTarget}`}
          className={buttonVariants({ size: 'small' })}
          href={recoveryPath}
        >
          {recoveryLabel}
        </Link>
      ) : null}
    </li>
  )
}
