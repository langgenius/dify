'use client'

import type { ReactNode } from 'react'
import type { MockVersion } from '../mock-data'
import type { DeploymentDialogRequest } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogCloseButton, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { MOCK_PUBLISHED_VERSIONS } from '../mock-data'

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

export function VersionChoice({
  version,
  current,
  onSelect,
}: {
  version: MockVersion
  current: boolean
  onSelect: (version: MockVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tWorkflow } = useTranslation('workflow')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <button
      type="button"
      disabled={current}
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

export function VersionSelection({
  request,
  onSelect,
}: {
  request: DeploymentDialogRequest
  onSelect: (version: MockVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const title =
    request.kind === 'deploy'
      ? t(($) => $['versions.deployTo'], { name: request.environment })
      : `${t(($) => $['studio.changeVersion'])} · ${request.environment}`

  return (
    <>
      <DialogCloseButton
        type="button"
        aria-label={tCommon(($) => $['operation.close'])}
        className="top-5 right-5 size-8 rounded-lg"
      />
      <header className="shrink-0 px-6 pt-6 pr-14 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </DialogDescription>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 pt-2 pb-4">
        <div className="flex flex-col gap-px">
          {MOCK_PUBLISHED_VERSIONS.map((version) => (
            <VersionChoice
              key={version.name}
              version={version}
              current={version.name === request.currentVersion}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </>
  )
}
