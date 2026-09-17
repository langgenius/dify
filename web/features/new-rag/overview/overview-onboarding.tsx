'use client'

import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValueRawSync } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import Link from '@/next/link'
import { newKnowledgeAddSourcePath, newKnowledgeDocumentsPath } from '../routes'
import { useKnowledgeSpacePermission } from '../space/context'
import {
  overviewEmptyAtom,
  overviewIndexingSourceNameAtom,
  overviewIndexingTaskAtom,
  overviewKnowledgeSpaceIdAtom,
  overviewShowIndexingAtom,
} from './state'

export function OverviewOnboarding() {
  const empty = useAtomValueRawSync(overviewEmptyAtom)
  const showIndexing = useAtomValueRawSync(overviewShowIndexingAtom)
  let content: ReactNode = null
  if (showIndexing) content = <IndexingProgress />
  else if (empty) content = <EmptyKnowledgeOnboarding />
  return content ? <div className="mt-3">{content}</div> : null
}

function IndexingProgress() {
  const { t } = useTranslation('knowledgeSpace')
  const indexingTask = useAtomValueRawSync(overviewIndexingTaskAtom)
  const indexingSourceName = useAtomValueRawSync(overviewIndexingSourceNameAtom)
  if (!indexingTask) return null

  const progressKnown = indexingTask.progress_total > 0
  return (
    <section className="flex h-29.75 flex-col rounded-xl bg-background-section p-4">
      <h2 className="text-[18px] leading-[1.2] font-semibold text-text-primary">
        {indexingSourceName
          ? t(($) => $['overview.indexingSource'], { source: indexingSourceName })
          : t(($) => $['overview.indexing'])}
      </h2>
      <p className="mt-1 text-[13px] leading-4 font-normal text-text-primary">
        {t(($) => $['overview.indexingConnectedDescription'])}
      </p>
      <div className="mt-3">
        <div
          role="progressbar"
          aria-label={t(($) => $['overview.indexing'])}
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
          {t(($) => $['overview.indexedDocuments'], {
            indexed: indexingTask.progress_completed,
            total: indexingTask.progress_total,
          })}
        </p>
      </div>
    </section>
  )
}

function EmptyKnowledgeOnboarding() {
  const { t } = useTranslation('knowledgeSpace')
  const knowledgeSpaceId = useAtomValueRawSync(overviewKnowledgeSpaceIdAtom)
  const uploadAvailable = useAtomValueRawSync(knowledgeFsUploadEnabledAtom)
  const canManageDocuments = useKnowledgeSpacePermission('knowledge_space_document_write')
  const [pendingAction, setPendingAction] = useState<'source' | 'upload'>()
  const canConnectSource = canManageDocuments
  const canUpload = uploadAvailable && canManageDocuments
  const actionCount = Number(canConnectSource) + Number(canUpload)
  const description = canConnectSource
    ? canUpload
      ? t(($) => $['overview.noSourcesDescription'])
      : t(($) => $.connectSourceDescription)
    : canUpload
      ? t(($) => $.uploadFilesDescription)
      : t(($) => $['overview.readOnlyDescription'])

  const beginNavigation = (action: 'source' | 'upload', event: MouseEvent<HTMLAnchorElement>) => {
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
    setPendingAction(action)
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
          {t(($) => $['overview.noSources'])}
        </h2>
        <p className="mt-1 body-xs-regular text-text-tertiary">{description}</p>
      </div>
      {actionCount > 0 && (
        <div
          className={cn('mt-3 grid gap-3', actionCount === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}
        >
          {canConnectSource && (
            <Link
              aria-label={t(($) => $['overview.connectSource'])}
              aria-busy={pendingAction === 'source' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => beginNavigation('source', event)}
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
                {t(($) => $['overview.connectSource'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $.connectSourceDescription)}
              </span>
            </Link>
          )}
          {canUpload && (
            <Link
              aria-label={t(($) => $['overview.uploadFiles'])}
              aria-busy={pendingAction === 'upload' || undefined}
              aria-disabled={pendingAction !== undefined}
              className={cn(
                'flex h-26.25 flex-col items-center justify-center rounded-[10px] border border-divider-regular bg-components-panel-on-panel-item-bg text-center outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                pendingAction !== undefined && 'pointer-events-none opacity-50',
              )}
              href={`${newKnowledgeDocumentsPath(knowledgeSpaceId)}?upload=1`}
              tabIndex={pendingAction === undefined ? undefined : -1}
              onClick={(event) => beginNavigation('upload', event)}
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
                {t(($) => $['overview.uploadFiles'])}
              </span>
              <span className="mt-0.5 system-sm-regular text-text-tertiary">
                {t(($) => $.uploadFilesDescription)}
              </span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
