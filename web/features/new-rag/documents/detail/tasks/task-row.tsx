'use client'

import type { KnowledgeFsTaskFailureMessageKey } from '../../../knowledge-fs-task-error'
import type { BackgroundTask } from '../../models'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KnowledgeTaskFailure } from '@/features/new-rag/components/knowledge-task-failure'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import {
  knowledgeFsRequestFailureMessageKey,
  knowledgeFsTaskFailureMessageKey,
  knowledgeFsTaskRecoveryPath,
} from '../../../knowledge-fs-task-error'
import {
  taskCanCancel,
  taskCanRetry,
  taskGraphIsActive,
  taskGraphIsIncomplete,
  taskIsActive,
} from '../../model'
import { taskLifecycle, taskProgress, taskTime } from '../../tasks/drawer-model'
import { DocumentGraphStatus } from '../../tasks/graph-status'
import { documentDetailKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentCanEditAtom, retryDocumentWritePermissionAtom } from '../state/workflow'
import { useRefreshDocumentWritePermission } from '../write-permission'

export const DOCUMENT_TASK_DRAWER_CLOSE_ID = 'document-task-drawer-close'

type TaskAction = 'cancel' | 'retry'

function focusDrawerCloseButton() {
  document.getElementById(DOCUMENT_TASK_DRAWER_CLOSE_ID)?.focus()
}

export function DocumentTaskRow({
  cancelActionCount,
  documentTitle,
  documentsPending,
  onFailed,
  retryActionCount,
  task,
}: {
  cancelActionCount: number
  documentTitle?: string
  documentsPending: boolean
  // A rejected cancel or retry may still have reached the server; the fallback refreshes after
  // a successful one.
  onFailed: () => Promise<unknown>
  retryActionCount: number
  task: BackgroundTask
}) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeTasks'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tError } = useTranslation(['knowledgeErrors'])
  const describeRequestError = useRequestErrorDescriber()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const knowledgeSpaceId = useAtomValueRawSync(documentDetailKnowledgeSpaceIdAtom)
  const canEdit = useAtomValueRawSync(documentCanEditAtom)
  const retryWritePermission = useSetAtom(retryDocumentWritePermissionAtom)
  const refreshWritePermission = useRefreshDocumentWritePermission()
  const actionButtonRef = useRef<HTMLButtonElement>(null)
  const currentLifecycle = taskLifecycle(task)
  const currentLifecycleRef = useRef(currentLifecycle)
  currentLifecycleRef.current = currentLifecycle
  const [actionFailure, setActionFailure] = useState<{
    lifecycle: string
    error: unknown
    messageKey?: KnowledgeFsTaskFailureMessageKey
  }>()
  const cancelTask = useMutation(
    // Cancel and retry failures are shown next to the task's action button.
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.cancel.post.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )
  const retryTask = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )
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
      ? (documentTitle ?? (documentsPending ? t(($) => $.documentColumn) : task.documentId))
      : undefined)
  const operationTitle = t(($) => $[`overview.operation.${task.operation}`], {
    ns: 'knowledgeTasks',
  })
  const progress = taskProgress(task)
  const title =
    task.operation === 'document_processing' && resolvedDocumentTitle
      ? `${t(($) => $.addDocument)} · ${resolvedDocumentTitle}`
      : task.operation === 'document_upload'
        ? `${t(($) => $.addDocument)}${progress ? ` · ${progress.total}` : ''}`
        : task.operation === 'document_reindex'
          ? `${t(($) => $.reindexDocuments)}${resolvedDocumentTitle ? ` · ${resolvedDocumentTitle}` : progress && progress.total > 1 ? ` · ${progress.total}` : ''}`
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
  const stateLabel = t(($) => $[`processingTaskState.${task.state}`], {
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
  const recoveryFailure = taskGraphIsIncomplete(task)
    ? (task.semanticEnrichment?.failure ?? undefined)
    : task.failure
  const recoveryPath = knowledgeFsTaskRecoveryPath(recoveryFailure, knowledgeSpaceId)
  const recoveryLabel =
    recoveryFailure?.action === 'configure_model'
      ? tCommon(($) => $['datasetMenus.settings'])
      : recoveryFailure?.action === 'configure_source'
        ? t(($) => $.openSource)
        : recoveryFailure?.action === 'reupload'
          ? t(($) => $.addDocument)
          : undefined
  const retryLabel = taskGraphIsIncomplete(task)
    ? t(($) => $.graphRepairRetry, { ns: 'knowledgeTasks' })
    : t(($) => $.retryTask)
  const actionTarget = `${title} · ${task.id}`

  async function performAction(action: TaskAction) {
    if (!canEdit || pending) return
    const actionLifecycle = currentLifecycle
    const actionFocusTarget = document.activeElement
    setActionFailure(undefined)
    try {
      const input = {
        params: {
          control_space_id: knowledgeSpaceId,
          task_id: task.id,
          task_kind: task.taskKind,
        },
      }
      if (action === 'cancel') await cancelTask.mutateAsync(input)
      else await retryTask.mutateAsync(input)
      if (currentLifecycleRef.current !== actionLifecycle) return
      if (document.activeElement === actionFocusTarget) focusDrawerCloseButton()
    } catch (error) {
      // A 403 is also how a knowledge rate limit fails, so the failure stays recorded while write
      // access is rechecked; it is shown only if that access holds.
      if (getHttpErrorStatus(error) === 403) void retryWritePermission(refreshWritePermission)
      const messageKey = await knowledgeFsRequestFailureMessageKey(error)
      if (currentLifecycleRef.current === actionLifecycle)
        setActionFailure({
          lifecycle: actionLifecycle,
          error,
          messageKey,
        })
      void onFailed()
    }
  }

  const actionFailureMessageKey = actionFailure?.messageKey

  return (
    <li className="flex min-h-15.5 items-center gap-2.5 py-3.5">
      <span
        aria-hidden
        className={
          task.state === 'failed' ||
          (task.state === 'succeeded' && task.semanticEnrichment?.state === 'failed')
            ? 'i-ri-error-warning-fill size-4 shrink-0 text-text-destructive'
            : task.state === 'dispatch_pending' ||
                task.state === 'queued' ||
                task.state === 'retry_wait'
              ? 'i-ri-time-line size-4 shrink-0 text-text-tertiary'
              : taskIsActive(task) || taskGraphIsActive(task)
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
        <DocumentGraphStatus task={task} />
        {taskFailureMessageKey && (
          <KnowledgeTaskFailure messageKey={taskFailureMessageKey} failure={task.failure} />
        )}
        {canEdit && actionFailure?.lifecycle === currentLifecycle && (
          <p className="mt-1 system-2xs-regular text-text-destructive" role="alert">
            {actionFailureMessageKey
              ? tError(($) => $[actionFailureMessageKey])
              : describeRequestError(
                  actionFailure.error,
                  t(($) => $.taskActionFailed),
                )}
          </p>
        )}
      </div>
      {canEdit && taskCanCancel(task) ? (
        <Button
          ref={actionButtonRef}
          aria-label={
            cancelActionCount > 1
              ? `${t(($) => $.interruptTask, { ns: 'knowledgeTasks' })} · ${actionTarget}`
              : undefined
          }
          size="small"
          loading={pending}
          onClick={() => void performAction('cancel')}
        >
          {t(($) => $.interruptTask, { ns: 'knowledgeTasks' })}
        </Button>
      ) : canEdit && taskCanRetry(task) ? (
        <Button
          ref={actionButtonRef}
          aria-label={retryActionCount > 1 ? `${retryLabel} · ${actionTarget}` : undefined}
          size="small"
          loading={pending}
          onClick={() => void performAction('retry')}
        >
          {retryLabel}
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
