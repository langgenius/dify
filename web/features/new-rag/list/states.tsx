'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { newKnowledgeCreatePathWithStartMode } from '../routes'

const LOADING_CARD_IDS = [
  'loading-card-1',
  'loading-card-2',
  'loading-card-3',
  'loading-card-4',
  'loading-card-5',
  'loading-card-6',
  'loading-card-7',
  'loading-card-8',
] as const

const EMPTY_GHOST_CARD_IDS = Array.from({ length: 16 }, (_, index) => `empty-ghost-card-${index}`)

export const KNOWLEDGE_SPACE_GRID_CLASS_NAME =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-2.5'

export function NewKnowledgeLoadingState() {
  const { t } = useTranslation('common')

  return (
    <div className={KNOWLEDGE_SPACE_GRID_CLASS_NAME} role="status" aria-label={t(($) => $.loading)}>
      {LOADING_CARD_IDS.map((id) => (
        <div
          key={id}
          className="h-41.5 rounded-xl border border-components-card-border bg-components-card-bg p-4 shadow-xs"
        >
          <SkeletonContainer className="h-full">
            <div className="flex gap-3">
              <SkeletonRectangle className="size-10 animate-pulse rounded-lg motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <SkeletonRectangle className="h-4 w-2/3 animate-pulse motion-reduce:animate-none" />
                <SkeletonRectangle className="h-3 w-1/3 animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
            <SkeletonRectangle className="mt-4 h-3 w-full animate-pulse motion-reduce:animate-none" />
            <SkeletonRectangle className="mt-2 h-3 w-4/5 animate-pulse motion-reduce:animate-none" />
          </SkeletonContainer>
        </div>
      ))}
    </div>
  )
}

export function NewKnowledgePageState({
  action,
  description,
  title,
}: {
  action?: ReactNode
  description: ReactNode
  title: ReactNode
}) {
  return (
    <div className="flex min-h-105 flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-components-card-border bg-components-card-bg shadow-xs">
        <span aria-hidden className="i-ri-book-open-line size-6 text-text-tertiary" />
      </div>
      <h2 className="title-2xl-semi-bold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-130 body-md-regular text-text-tertiary">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

function EmptyAction({
  description,
  href,
  iconClassName,
  iconSizeClassName,
  recommended = false,
  title,
}: {
  description: string
  href?: string
  iconClassName: string
  iconSizeClassName?: string
  recommended?: boolean
  title: string
}) {
  const { t } = useTranslation('dataset')
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const recommendedLabel = t(($) => $['firstEmpty.recommended'])
  const descriptionId = useId()
  const unavailableId = useId()
  const recommendedId = useId()

  return (
    <ButtonOrLink
      href={href}
      aria-label={title}
      aria-describedby={`${descriptionId}${href ? '' : ` ${unavailableId}`}${recommended ? ` ${recommendedId}` : ''}`}
      className="relative flex min-h-14.5 w-full items-center overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2 text-left text-text-secondary outline-hidden backdrop-blur-[6px] hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-components-button-secondary-bg"
    >
      <span className="mr-3 flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
        <span
          aria-hidden
          className={cn(
            iconClassName,
            'size-4',
            iconSizeClassName,
            href ? 'text-text-tertiary' : 'text-text-disabled',
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block system-md-medium',
            href ? 'text-text-primary' : 'text-text-disabled',
          )}
        >
          {title}
        </span>
        <span
          id={descriptionId}
          className={cn(
            'mt-0.5 block system-xs-regular',
            href ? 'text-text-tertiary' : 'text-text-disabled',
          )}
        >
          {description}
        </span>
      </span>
      {!href && (
        <span id={unavailableId} className="ml-3 shrink-0 system-xs-medium text-text-disabled">
          {unavailable}
        </span>
      )}
      {recommended && (
        <div id={recommendedId}>
          <CornerLabel
            label={recommendedLabel}
            className="absolute top-0 right-0 z-5"
            cornerClassName="text-util-colors-indigo-indigo-100"
            labelClassName="-ml-px rounded-tr-xl bg-util-colors-indigo-indigo-100 pr-2"
            textClassName="text-util-colors-indigo-indigo-700"
          />
        </div>
      )}
    </ButtonOrLink>
  )
}

function ButtonOrLink({
  children,
  href,
  ...props
}: {
  'aria-describedby': string
  'aria-label': string
  children: ReactNode
  className: string
  href?: string
}) {
  if (href)
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    )

  return (
    <button type="button" disabled {...props}>
      {children}
    </button>
  )
}

function EmptyGhostGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-x-8 inset-y-2 grid grid-cols-4 gap-3">
        {EMPTY_GHOST_CARD_IDS.map((id) => (
          <div key={id} className="h-52.25 rounded-xl bg-background-default-lighter opacity-75" />
        ))}
      </div>
      <div className="absolute inset-0 bg-linear-to-b from-background-body-transparent to-background-body" />
    </div>
  )
}

export function NewKnowledgeEmptyState({
  canConnect,
  canCreate,
  uploadAvailable,
}: {
  canConnect: boolean
  canCreate: boolean
  uploadAvailable: boolean
}) {
  const { t } = useTranslation('dataset')
  const canStart = canCreate

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 text-center">
      <EmptyGhostGrid />
      <div className="relative z-10 flex w-full flex-col items-center gap-6">
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-[6px]">
            <span aria-hidden className="i-custom-public-new-rag-book-open size-6" />
          </div>
          <div className="flex w-full flex-col items-center gap-1">
            <h2 className="system-xl-semibold text-text-primary">
              {t(($) => $['newKnowledge.emptyTitle'])}
            </h2>
            <p className="w-full max-w-146.5 text-[13px]/5 font-normal text-text-tertiary">
              {t(($) => $['newKnowledge.emptyDescription'])}
            </p>
          </div>
        </div>
        {canStart ? (
          <div className="flex w-full max-w-130 flex-col gap-2 pb-8">
            {canConnect && (
              <EmptyAction
                recommended
                iconClassName="i-custom-public-new-rag-connect-source"
                iconSizeClassName="size-3"
                title={t(($) => $['newKnowledge.connectSource'])}
                description={t(($) => $['newKnowledge.connectSourceDescription'])}
                href={newKnowledgeCreatePathWithStartMode('source')}
              />
            )}
            {canCreate && (
              <EmptyAction
                iconClassName="i-ri-file-text-line"
                title={t(($) => $['newKnowledge.uploadFiles'])}
                description={t(($) => $['newKnowledge.uploadFilesDescription'])}
                href={uploadAvailable ? newKnowledgeCreatePathWithStartMode('upload') : undefined}
              />
            )}
            {canCreate && (
              <>
                <div className="flex h-4 items-center gap-2 system-xs-medium-uppercase text-text-tertiary">
                  <span className="h-px flex-1 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_0%,rgba(16,24,40,0.08)_100%)]" />
                  <span>{t(($) => $['firstEmpty.or'])}</span>
                  <span className="h-px flex-1 bg-[linear-gradient(to_left,rgba(255,255,255,0.01)_0%,rgba(16,24,40,0.08)_100%)]" />
                </div>
                <EmptyAction
                  iconClassName="i-ri-folder-6-line"
                  title={t(($) => $['newKnowledge.startEmpty'])}
                  description={t(($) => $['newKnowledge.startEmptyDescription'])}
                  href={newKnowledgeCreatePathWithStartMode('empty')}
                />
              </>
            )}
          </div>
        ) : (
          <span className="mt-6 body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.readOnlyEmpty'])}
          </span>
        )}
      </div>
    </div>
  )
}
