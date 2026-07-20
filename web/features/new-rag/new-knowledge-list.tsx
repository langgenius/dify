'use client'

import type { KnowledgeSpace } from '@dify/contracts/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import ExternalAPIPanel from '@/app/components/datasets/external-api/external-api-panel'
import ServiceApi from '@/app/components/datasets/extra-info/service-api'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
import { hasPermission } from '@/utils/permission'

const PAGE_SIZE = 30
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

type NewKnowledgeListProps = {
  viewSwitcher: ReactNode
}

function UnavailableReason({ label, reason }: { label: string; reason: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        aria-label={label}
        render={
          <button
            type="button"
            className="flex size-6 shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-information-line size-4" />
          </button>
        }
      />
      <PopoverContent
        placement="bottom"
        sideOffset={6}
        popupClassName="max-w-[260px] rounded-md bg-components-tooltip-bg px-3 py-2 system-xs-regular text-text-tertiary shadow-lg"
      >
        <PopoverTitle className="system-xs-regular text-text-tertiary">{reason}</PopoverTitle>
      </PopoverContent>
    </Popover>
  )
}

function LoadingState() {
  const { t } = useTranslation('common')

  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,296px),1fr))] gap-3"
      role="status"
      aria-label={t(($) => $.loading)}
    >
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
            <SkeletonRectangle className="mt-5 h-3 w-full animate-pulse motion-reduce:animate-none" />
            <SkeletonRectangle className="mt-2 h-3 w-4/5 animate-pulse motion-reduce:animate-none" />
          </SkeletonContainer>
        </div>
      ))}
    </div>
  )
}

function PageState({
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

function KnowledgeSpaceCard({ knowledgeSpace }: { knowledgeSpace: KnowledgeSpace }) {
  const { t } = useTranslation('dataset')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const updatedAt = Date.parse(knowledgeSpace.updatedAt)
  const formattedUpdatedAt = Number.isNaN(updatedAt)
    ? knowledgeSpace.updatedAt
    : formatTimeFromNow(updatedAt)

  return (
    <li>
      <article
        aria-label={`${knowledgeSpace.name}. ${unavailable}`}
        className="relative flex h-[166px] w-full cursor-not-allowed flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg text-left shadow-xs"
      >
        <CornerLabel
          label={unavailable}
          className="absolute top-0 right-0"
          labelClassName="rounded-tr-xl"
        />
        <div className="flex w-full items-center gap-3 px-4 pt-4 pb-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft">
            <span aria-hidden className="i-ri-book-open-line size-5 text-text-tertiary" />
          </div>
          <div className="min-w-0 flex-1 py-px pr-16">
            <h2 className="truncate system-md-semibold text-text-secondary">
              {knowledgeSpace.name}
            </h2>
          </div>
        </div>
        <p className="line-clamp-3 w-full px-4 py-1 body-xs-regular text-text-tertiary">
          {knowledgeSpace.description || t(($) => $['newKnowledge.noDescription'])}
        </p>
        <div className="mt-auto flex w-full min-w-0 items-center gap-2 px-4 pt-2 pb-3 system-xs-regular text-text-tertiary">
          <span className="shrink-0 text-text-disabled">
            {t(($) => $['newKnowledge.documentsUnavailable'])}
          </span>
          <span aria-hidden className="text-divider-deep">
            ·
          </span>
          <span className="shrink-0 text-text-disabled">
            {t(($) => $['newKnowledge.appsUnavailable'])}
          </span>
          <span className="ml-auto min-w-0 truncate text-right">
            {t(($) => $['newKnowledge.updated'], {
              date: formattedUpdatedAt,
            })}
          </span>
        </div>
      </article>
    </li>
  )
}

function isUnavailableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? error.status : undefined
  if (status === 404 || status === 503) return true

  const data = 'data' in error ? error.data : undefined
  if (!data || typeof data !== 'object') return false
  const dataStatus = 'status' in data ? data.status : undefined
  return dataStatus === 404 || dataStatus === 503
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
  const descriptionId = useId()
  const unavailableId = useId()
  const recommendedId = useId()

  return (
    <button
      type="button"
      disabled
      aria-label={title}
      aria-describedby={`${descriptionId} ${unavailableId}${recommended ? ` ${recommendedId}` : ''}`}
      className="relative flex min-h-[58px] w-full cursor-not-allowed items-center overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2 text-left text-text-disabled outline-hidden backdrop-blur-[6px]"
    >
      <span className="mr-3 flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-default-subtle">
        <span aria-hidden className={`${iconClassName} size-4 text-text-disabled`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block system-md-medium text-text-disabled">{title}</span>
        <span id={descriptionId} className="mt-0.5 block system-xs-regular text-text-disabled">
          {description}
        </span>
      </span>
      <span id={unavailableId} className="ml-3 shrink-0 system-xs-medium text-text-disabled">
        {unavailable}
      </span>
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
    </button>
  )
}

function EmptyState({ canConnect, canCreate }: { canConnect: boolean; canCreate: boolean }) {
  const { t } = useTranslation('dataset')
  const canStart = canConnect || canCreate

  return (
    <div className="flex min-h-[calc(100vh-134px)] items-center justify-center px-4 py-16 text-center sm:px-6">
      <div className="flex w-full max-w-[520px] flex-col items-center gap-6">
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

function DisabledMetadataFilter({ label, reasonId }: { label: string; reasonId: string }) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={reasonId}
      className="flex h-8 cursor-not-allowed items-center rounded-lg border-[0.5px] border-transparent bg-components-input-bg-disabled px-2 text-components-input-text-filled-disabled"
    >
      <span className="px-1 system-sm-regular">{label}</span>
      <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
    </button>
  )
}

export function NewKnowledgeList({ viewSwitcher }: NewKnowledgeListProps) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreate = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnect = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const showCreateAction = canCreate || canConnect
  const filtersUnavailable = t(($) => $['newKnowledge.filtersUnavailable'])
  const unavailable = t(($) => $['cornerLabel.unavailable'])
  const createLabel = tCommon(($) => $['operation.create'])
  const filtersUnavailableId = useId()
  const createUnavailableId = useId()
  const knowledgeSpacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.listKnowledgeSpaces.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
    }),
  )
  const knowledgeSpaces = knowledgeSpacesQuery.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      <header className="sticky top-0 z-10 flex flex-col gap-[14px] bg-background-body px-4 pt-4 pb-2 sm:px-8">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">
              {t(($) => $.knowledge)}
            </h1>
            {viewSwitcher}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canConnect && (
              <button
                type="button"
                className="flex h-6 items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setShowExternalApiPanel(true)}
              >
                <span
                  aria-hidden
                  className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
                />
                <span className="px-0.5 system-xs-medium">{t(($) => $.externalAPIPanelTitle)}</span>
              </button>
            )}
            <ServiceApi apiBaseUrl={apiBaseInfo?.api_base_url ?? ''} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DisabledMetadataFilter
              label={t(($) => $['newKnowledge.tags'])}
              reasonId={filtersUnavailableId}
            />
            <DisabledMetadataFilter
              label={t(($) => $['newKnowledge.creators'])}
              reasonId={filtersUnavailableId}
            />
            <SearchInput
              disabled
              aria-describedby={filtersUnavailableId}
              className="w-[200px]"
              value=""
              onValueChange={() => undefined}
            />
            <span id={filtersUnavailableId} className="sr-only">
              {filtersUnavailable}
            </span>
            <UnavailableReason label={filtersUnavailable} reason={filtersUnavailable} />
          </div>
          {showCreateAction && (
            <div className="flex items-center gap-1">
              <Button
                disabled
                aria-describedby={createUnavailableId}
                variant="primary"
                size="medium"
                className="gap-0.5 px-2 shadow-xs"
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                <span className="pl-1">{createLabel}</span>
              </Button>
              <span id={createUnavailableId} className="sr-only">
                {unavailable}
              </span>
              <UnavailableReason label={`${createLabel}. ${unavailable}`} reason={unavailable} />
            </div>
          )}
        </div>
      </header>
      <div className="px-4 pt-2 pb-8 sm:px-8">
        {knowledgeSpacesQuery.isPending ? (
          <LoadingState />
        ) : knowledgeSpacesQuery.error && !knowledgeSpacesQuery.data ? (
          isUnavailableError(knowledgeSpacesQuery.error) ? (
            <PageState
              title={t(($) => $['newKnowledge.unavailableTitle'])}
              description={t(($) => $['newKnowledge.unavailableDescription'])}
            />
          ) : (
            <PageState
              title={t(($) => $['newKnowledge.errorTitle'])}
              description={t(($) => $['newKnowledge.errorDescription'])}
              action={
                <Button onClick={() => void knowledgeSpacesQuery.refetch()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              }
            />
          )
        ) : knowledgeSpaces.length === 0 ? (
          <EmptyState canConnect={canConnect} canCreate={canCreate} />
        ) : (
          <>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,296px),1fr))] gap-3"
              aria-label={t(($) => $.knowledge)}
            >
              {knowledgeSpaces.map((knowledgeSpace) => (
                <KnowledgeSpaceCard key={knowledgeSpace.id} knowledgeSpace={knowledgeSpace} />
              ))}
            </ul>
            {knowledgeSpacesQuery.isFetchNextPageError ? (
              <div className="mt-6 flex items-center justify-center gap-3" role="alert">
                <span>{t(($) => $['newKnowledge.errorDescription'])}</span>
                <Button onClick={() => void knowledgeSpacesQuery.fetchNextPage()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            ) : knowledgeSpacesQuery.hasNextPage ? (
              <div className="mt-6 flex justify-center">
                <Button
                  loading={knowledgeSpacesQuery.isFetchingNextPage}
                  onClick={() => void knowledgeSpacesQuery.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {showExternalApiPanel && canConnect && (
        <ExternalAPIPanel
          canManageExternalKnowledgeApi={canConnect}
          onClose={() => setShowExternalApiPanel(false)}
        />
      )}
    </div>
  )
}
