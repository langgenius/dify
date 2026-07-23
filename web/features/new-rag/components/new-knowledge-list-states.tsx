import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import FirstEmptyActionCard from '@/app/components/apps/first-empty-state/action-card'
import { Infotip } from '@/app/components/base/infotip'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'

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

export function UnavailableReason({ label, reason }: { label: string; reason: string }) {
  return (
    <Infotip
      aria-label={label}
      iconVariant="information"
      iconSize="large"
      placement="bottom"
      sideOffset={6}
      className="size-6 rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      popupClassName="max-w-[260px] bg-components-tooltip-bg shadow-lg"
    >
      {reason}
    </Infotip>
  )
}

export function NewKnowledgeLoadingState() {
  const { t } = useTranslation('common')

  return (
    <div className={KNOWLEDGE_SPACE_GRID_CLASS_NAME} role="status" aria-label={t(($) => $.loading)}>
      {LOADING_CARD_IDS.map((id) => (
        <div
          key={id}
          className="h-[166px] rounded-xl border border-components-card-border bg-components-card-bg p-4 shadow-xs"
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
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-components-card-border bg-components-card-bg shadow-xs">
        <span aria-hidden className="i-ri-book-open-line size-6 text-text-tertiary" />
      </div>
      <h2 className="title-2xl-semi-bold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-[520px] body-md-regular text-text-tertiary">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}

function EmptyAction({
  description,
  iconClassName,
  recommended = false,
  title,
}: {
  description: string
  iconClassName: string
  recommended?: boolean
  title: string
}) {
  const { t } = useTranslation('dataset')
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const recommendedLabel = t(($) => $['firstEmpty.recommended'])

  return (
    <FirstEmptyActionCard
      disabled
      disabledReason={unavailable}
      badge={recommended ? recommendedLabel : undefined}
      className="min-h-[58px] py-2 backdrop-blur-[6px]"
      description={description}
      icon={<span aria-hidden className={`${iconClassName} size-4 text-text-disabled`} />}
      title={title}
      visualStyle="list"
    />
  )
}

function EmptyGhostGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_22%,black_68%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_22%,black_68%,transparent)]"
    >
      <div className="absolute top-0 left-1/2 grid w-[1200px] -translate-x-1/2 grid-cols-4 gap-2.5 opacity-35">
        {EMPTY_GHOST_CARD_IDS.map((id) => (
          <div
            key={id}
            className="h-[209px] rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className="size-10 shrink-0 rounded-[10px] bg-background-section" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded-sm bg-background-section" />
                <div className="h-2.5 w-1/3 rounded-sm bg-background-section" />
              </div>
            </div>
            <div className="mt-4 h-2.5 w-full rounded-sm bg-background-section" />
            <div className="mt-2 h-2.5 w-4/5 rounded-sm bg-background-section" />
            <div className="mt-5 h-5 w-16 rounded-md bg-background-section" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function NewKnowledgeEmptyState({
  canConnect,
  canCreate,
}: {
  canConnect: boolean
  canCreate: boolean
}) {
  const { t } = useTranslation('dataset')
  const canStart = canConnect || canCreate

  return (
    <div className="relative isolate flex min-h-[calc(100vh-134px)] items-center justify-center overflow-hidden px-4 py-16 text-center sm:px-6">
      <EmptyGhostGrid />
      <div className="relative z-10 flex w-full max-w-[520px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-[6px]">
            <span aria-hidden className="i-ri-book-open-line size-6 text-text-accent" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h2 className="title-lg-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.emptyTitle'])}
            </h2>
            <p className="body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.emptyDescription'])}
            </p>
          </div>
        </div>
        {canStart ? (
          <div className="flex w-full flex-col gap-2 pb-8">
            {canConnect && (
              <EmptyAction
                recommended
                iconClassName="i-custom-vender-solid-development-api-connection-mod"
                title={t(($) => $['newKnowledge.connectSource'])}
                description={t(($) => $['newKnowledge.connectSourceDescription'])}
              />
            )}
            {canCreate && (
              <EmptyAction
                iconClassName="i-ri-file-text-line"
                title={t(($) => $['newKnowledge.uploadFiles'])}
                description={t(($) => $['newKnowledge.uploadFilesDescription'])}
              />
            )}
            {canCreate && (
              <>
                <div className="flex h-4 items-center gap-2 system-xs-medium-uppercase text-text-tertiary">
                  <span className="h-px flex-1 bg-divider-subtle" />
                  <span>{t(($) => $['firstEmpty.or'])}</span>
                  <span className="h-px flex-1 bg-divider-subtle" />
                </div>
                <EmptyAction
                  iconClassName="i-ri-folder-6-line"
                  title={t(($) => $['newKnowledge.startEmpty'])}
                  description={t(($) => $['newKnowledge.startEmptyDescription'])}
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
