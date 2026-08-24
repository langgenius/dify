'use client'
import type { ReactNode } from 'react'
import type { DeploymentVersion } from '../../version'
import type { DeploymentDialogRequest } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogClose, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { useInfiniteScroll } from '../../hooks/use-infinite-scroll'
import {
  appWorkflowVersionsAtom,
  appWorkflowVersionsErrorAtom,
  appWorkflowVersionsFetchNextPageAtom,
  appWorkflowVersionsHasNextPageAtom,
  appWorkflowVersionsIsFetchingAtom,
  appWorkflowVersionsIsFetchingNextPageAtom,
  appWorkflowVersionsIsLoadingAtom,
} from '../../state'

function VersionBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-text-accent bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-accent">
      {children}
    </span>
  )
}

function VersionTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 system-2xs-medium text-text-tertiary">
      {children}
    </span>
  )
}

function VersionChoice({
  version,
  current,
  disabled = false,
  onSelect,
}: {
  version: DeploymentVersion
  current: boolean
  disabled?: boolean
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <button
      type="button"
      disabled={current || disabled}
      onClick={() => onSelect(version)}
      className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg p-2 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn('truncate system-md-medium text-text-secondary', current && 'opacity-50')}
        >
          {version.name}
        </span>
        {version.latest && <VersionBadge>{t(($) => $['overview.chip.latest'])}</VersionBadge>}
        {current && <VersionBadge>{t(($) => $['studio.current'])}</VersionBadge>}
      </span>
      {version.description && (
        <span className="line-clamp-3 system-xs-regular text-text-tertiary">
          {version.description}
        </span>
      )}
      {version.publishedAt !== undefined && version.publishedBy && (
        <span className={cn('system-xs-regular text-text-tertiary', current && 'opacity-50')}>
          {tWorkflow(($) => $['common.publishedBy'], {
            time: formatTimeFromNow(version.publishedAt),
            author: version.publishedBy,
          })}
        </span>
      )}
      {version.tags && version.tags.length > 0 && (
        <span className="flex flex-wrap items-center gap-1 pt-1">
          {version.tags.map((tag) => (
            <VersionTag key={tag}>{tag}</VersionTag>
          ))}
        </span>
      )}
    </button>
  )
}

function VersionList({
  className,
  currentVersionId,
  disabled = false,
  publishHref,
  onSelect,
}: {
  className?: string
  currentVersionId?: string
  disabled?: boolean
  publishHref?: string
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('deployments')
  const versions = useAtomValue(appWorkflowVersionsAtom)
  const versionsError = useAtomValue(appWorkflowVersionsErrorAtom)
  const fetchNextPage = useAtomValue(appWorkflowVersionsFetchNextPageAtom)
  const hasNextPage = useAtomValue(appWorkflowVersionsHasNextPageAtom)
  const isFetching = useAtomValue(appWorkflowVersionsIsFetchingAtom)
  const isFetchingNextPage = useAtomValue(appWorkflowVersionsIsFetchingNextPageAtom)
  const isLoading = useAtomValue(appWorkflowVersionsIsLoadingAtom)
  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement>({
    error: versionsError,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
  })

  return (
    <div ref={rootRef} className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      <div className="flex flex-col gap-px">
        {versions.map((version) => (
          <VersionChoice
            key={version.id}
            version={version}
            current={version.id === currentVersionId}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
      {isLoading && (
        <div
          role="status"
          aria-label={tCommon(($) => $.loading)}
          className="flex h-20 items-center justify-center"
        >
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
          />
        </div>
      )}
      {!isLoading && versionsError && versions.length === 0 && (
        <p role="alert" className="px-2 py-6 text-center system-xs-regular text-text-tertiary">
          {tCommon(($) => $.error)}
        </p>
      )}
      {!isLoading && !versionsError && versions.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-2 py-6">
          <p className="text-center system-sm-regular text-text-tertiary">
            {t(($) => $['studio.accessPoint.noPublishedTitle'])}
          </p>
          {publishHref && (
            <Button
              size="medium"
              render={<Link href={publishHref} />}
              className="flex items-center gap-1"
            >
              {t(($) => $['studio.accessPoint.goToPublish'])}
              <span aria-hidden className="i-ri-arrow-right-line size-4" />
            </Button>
          )}
        </div>
      )}
      {isFetchingNextPage && versions.length > 0 && (
        <div
          role="status"
          aria-label={tCommon(($) => $.loading)}
          className="flex h-8 items-center justify-center"
        >
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
          />
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-px" />
    </div>
  )
}

function versionSelectionTitle(request: DeploymentDialogRequest, deployTo: string, change: string) {
  return request.kind === 'deploy' ? deployTo : `${change} · ${request.environment}`
}

export function VersionSelection({
  appId,
  request,
  onSelect,
}: {
  appId: string
  request: DeploymentDialogRequest
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const title = versionSelectionTitle(
    request,
    t(($) => $['versions.deployTo'], { name: request.environment }),
    t(($) => $['studio.changeVersion']),
  )

  return (
    <>
      <DialogClose
        render={
          <IconButton
            aria-label={tCommon(($) => $['operation.close'])}
            size="lg"
            className="absolute top-5 right-5"
            type="button"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />
      <header className="shrink-0 px-6 pt-6 pr-14 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </DialogDescription>
      </header>
      <VersionList
        className="px-4 pt-2 pb-4"
        currentVersionId={request.currentVersionId}
        publishHref={`/app/${appId}/workflow`}
        onSelect={onSelect}
      />
    </>
  )
}

export function EmbeddedVersionSelection({
  disabled,
  request,
  onBack,
  onSelect,
}: {
  disabled: boolean
  request: DeploymentDialogRequest
  onBack: () => void
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const title = versionSelectionTitle(
    request,
    t(($) => $['versions.deployTo'], { name: request.environment }),
    t(($) => $['studio.changeVersion']),
  )

  return (
    <div className="flex h-133 max-h-[calc(100dvh-32px)] min-h-0 flex-none flex-col">
      <header className="shrink-0 px-3 pt-3.5 pb-1">
        <Button
          type="button"
          size="small"
          variant="ghost-accent"
          className="-ml-1 h-6 gap-1 px-1 system-xs-semibold-uppercase"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {tCommon(($) => $['operation.back'])}
        </Button>
        <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">{title}</h2>
        <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </p>
      </header>
      <VersionList
        className="p-2"
        currentVersionId={request.currentVersionId}
        disabled={disabled}
        onSelect={onSelect}
      />
    </div>
  )
}
