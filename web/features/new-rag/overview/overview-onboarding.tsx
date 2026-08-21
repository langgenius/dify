'use client'

import type { KnowledgeFsBackgroundTaskResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { newKnowledgeAddSourcePath, newKnowledgeDocumentsPath } from '../routes'

export function Onboarding({
  canConnectSource,
  canUpload,
  indexingTask,
  indexingSourceName,
  knowledgeSpaceId,
}: {
  canConnectSource: boolean
  canUpload: boolean
  indexingTask?: KnowledgeFsBackgroundTaskResponse
  indexingSourceName?: string
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const [pendingAction, setPendingAction] = useState<'source' | 'upload'>()
  const actionCount = Number(canConnectSource) + Number(canUpload)
  const description = canConnectSource
    ? canUpload
      ? t(($) => $['newKnowledge.overview.noSourcesDescription'])
      : t(($) => $['newKnowledge.connectSourceDescription'])
    : canUpload
      ? t(($) => $['newKnowledge.uploadFilesDescription'])
      : t(($) => $['newKnowledge.overview.readOnlyDescription'])
  if (indexingTask) {
    const progressKnown = indexingTask.progress_total > 0
    return (
      <section className="flex h-29.75 flex-col rounded-xl bg-background-section p-4">
        <h2 className="text-[18px] leading-[1.2] font-semibold text-text-primary">
          {indexingSourceName
            ? t(($) => $['newKnowledge.overview.indexingSource'], {
                source: indexingSourceName,
              })
            : t(($) => $['newKnowledge.overview.indexing'])}
        </h2>
        <p className="mt-1 text-[13px] leading-4 font-normal text-text-primary">
          {t(($) => $['newKnowledge.overview.indexingConnectedDescription'])}
        </p>
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={t(($) => $['newKnowledge.overview.indexing'])}
            aria-valuemin={0}
            aria-valuemax={progressKnown ? indexingTask.progress_total : undefined}
            aria-valuenow={progressKnown ? indexingTask.progress_completed : undefined}
            className="h-2 overflow-hidden rounded-full bg-util-colors-gray-gray-200"
          >
            <div
              className="h-full rounded-full bg-components-progress-bar-progress-solid"
              style={{ width: `${indexingTask.progress_percent}%` }}
            />
          </div>
          <p className="mt-2.5 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.overview.indexedDocuments'], {
              indexed: indexingTask.progress_completed,
              total: indexingTask.progress_total,
            })}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'h-auto min-w-0 rounded-xl bg-background-section p-4',
        actionCount > 0 && 'md:h-54.75',
      )}
    >
      <div aria-hidden className="flex h-4 items-center gap-1.5 text-text-tertiary">
        <span className="text-[13px] leading-4">🔥</span>
        <span className="i-custom-public-llm-jina size-4" />
        <span className="i-custom-public-common-notion size-4" />
        <span className="i-custom-public-common-google-drive size-4" />
        <span className="i-custom-public-new-rag-confluence size-4" />
        <span className="i-ri-more-fill size-4" />
      </div>
      <div className="mt-3 h-10.5">
        <h2 className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.overview.noSources'])}
        </h2>
        <p className="mt-1 body-xs-regular text-text-tertiary">{description}</p>
      </div>
      {actionCount > 0 && (
        <div
          className={cn('mt-3 grid gap-3', actionCount === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}
        >
          {canConnectSource && (
            <Link
              aria-label={t(($) => $['newKnowledge.overview.connectSource'])}
              aria-busy={pendingAction === 'source' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                if (pendingAction !== undefined) {
                  event.preventDefault()
                  return
                }
                setPendingAction('source')
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'size-6 text-text-accent',
                  pendingAction === 'source'
                    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                    : 'i-ri-node-tree',
                )}
              />
              <span className="mt-2 system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.overview.connectSource'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.connectSourceDescription'])}
              </span>
            </Link>
          )}
          {canUpload && (
            <Link
              aria-label={t(($) => $['newKnowledge.overview.uploadFiles'])}
              aria-busy={pendingAction === 'upload' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={`${newKnowledgeDocumentsPath(knowledgeSpaceId)}?upload=1`}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                if (pendingAction !== undefined) {
                  event.preventDefault()
                  return
                }
                setPendingAction('upload')
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'size-6 text-text-accent',
                  pendingAction === 'upload'
                    ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                    : 'i-ri-file-text-line',
                )}
              />
              <span className="mt-2 system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.overview.uploadFiles'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.uploadFilesDescription'])}
              </span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

export function FirstSourceTaskFailureBanner({
  failedTask,
  knowledgeSpaceId,
  onRetryTask,
}: {
  failedTask: KnowledgeFsBackgroundTaskResponse
  knowledgeSpaceId: string
  onRetryTask: () => Promise<unknown>
}) {
  const { t } = useTranslation('dataset')
  const retryTaskMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.byTaskKind.byTaskId.retry.post.mutationOptions(),
  )
  const description =
    failedTask.operation === 'document_upload' || failedTask.operation === 'document_processing'
      ? t(($) => $['newKnowledge.documentUploadFailed'])
      : t(($) => $['newKnowledge.addSourceFailed'])
  const retryFailedTask = async () => {
    if (!failedTask.can_retry || retryTaskMutation.isPending) return

    try {
      await retryTaskMutation.mutateAsync({
        params: {
          control_space_id: knowledgeSpaceId,
          task_id: failedTask.id,
          task_kind: failedTask.task_kind,
        },
      })
      await onRetryTask()
    } catch {
      // Mutation state keeps the retry feedback visible.
    }
  }

  return (
    <div
      className="mt-4 flex items-center gap-2.5 overflow-hidden rounded-lg bg-state-destructive-hover px-3.5 py-2.5"
      role="alert"
    >
      <span aria-hidden className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
      <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
        {retryTaskMutation.isError
          ? t(($) => $['newKnowledge.detailErrorDescription'])
          : description}
      </p>
      {failedTask.can_retry && (
        <Button
          size="small"
          variant="secondary"
          loading={retryTaskMutation.isPending}
          onClick={() => void retryFailedTask()}
        >
          {t(($) => $['newKnowledge.retryTask'])}
        </Button>
      )}
    </div>
  )
}
