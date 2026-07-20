'use client'

import type { KnowledgeSpace } from '@dify/contracts/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { parseAsString, useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import ExternalAPIPanel from '@/app/components/datasets/external-api/external-api-panel'
import ServiceApi from '@/app/components/datasets/extra-info/service-api'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
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
const EMPTY_CARD_IDS = [
  'empty-card-1',
  'empty-card-2',
  'empty-card-3',
  'empty-card-4',
  'empty-card-5',
  'empty-card-6',
  'empty-card-7',
  'empty-card-8',
  'empty-card-9',
  'empty-card-10',
  'empty-card-11',
  'empty-card-12',
  'empty-card-13',
  'empty-card-14',
  'empty-card-15',
  'empty-card-16',
] as const

type NewKnowledgeListProps = {
  viewSwitcher: ReactNode
}

function LoadingState() {
  const { t } = useTranslation('common')

  return (
    <div
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
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
              <SkeletonRectangle className="size-10 animate-pulse rounded-lg" />
              <div className="flex-1 space-y-2">
                <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
              </div>
            </div>
            <SkeletonRectangle className="mt-5 h-3 w-full animate-pulse" />
            <SkeletonRectangle className="mt-2 h-3 w-4/5 animate-pulse" />
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

function formatUpdatedAt(value: string) {
  const updatedAt = new Date(value)
  const elapsedSeconds = Math.round((updatedAt.getTime() - Date.now()) / 1000)

  if (Number.isNaN(elapsedSeconds)) return value

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]
  const [unit, seconds] = units.find(
    ([, unitSeconds]) => Math.abs(elapsedSeconds) >= unitSeconds,
  ) ?? ['second', 1]

  return formatter.format(Math.round(elapsedSeconds / seconds), unit)
}

function KnowledgeSpaceCard({ knowledgeSpace }: { knowledgeSpace: KnowledgeSpace }) {
  const { t } = useTranslation('dataset')
  const { push } = useRouter()

  return (
    <li>
      <button
        type="button"
        className="relative flex h-[166px] w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg text-left shadow-xs outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => push(`/datasets/new/${knowledgeSpace.id}`)}
      >
        <div className="flex w-full items-center gap-3 px-4 pt-4 pb-2">
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft text-[24px]/[1.2]">
            <span aria-hidden>📙</span>
            <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-sm border border-components-panel-on-panel-item-bg bg-util-colors-indigo-indigo-600 bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100">
              <span
                aria-hidden
                className="i-ri-layout-grid-line size-3 text-text-primary-on-surface"
              />
            </span>
          </div>
          <div className="min-w-0 flex-1 py-px">
            <h2 className="truncate system-md-semibold text-text-secondary">
              {knowledgeSpace.name}
            </h2>
          </div>
        </div>
        <p className="line-clamp-3 w-full px-4 py-1 body-xs-regular text-text-tertiary">
          {knowledgeSpace.description || t(($) => $['newKnowledge.noDescription'])}
        </p>
        <div className="mt-auto flex w-full items-center px-4 pt-2 pb-3 system-xs-regular text-text-tertiary">
          <span className="min-w-0 truncate">
            {t(($) => $['newKnowledge.updated'], {
              date: formatUpdatedAt(knowledgeSpace.updatedAt),
            })}
          </span>
        </div>
      </button>
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
  onClick,
}: {
  description: ReactNode
  iconClassName: string
  recommended?: boolean
  title: ReactNode
  onClick: () => void
}) {
  const { t } = useTranslation('dataset')

  return (
    <button
      type="button"
      className="relative flex h-[58px] w-full items-center overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 text-left outline-hidden backdrop-blur-[6px] transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={onClick}
    >
      <span className="mr-3 flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-default-subtle">
        <span aria-hidden className={`${iconClassName} size-4 text-text-tertiary`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block system-md-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block truncate system-xs-regular text-text-tertiary">
          {description}
        </span>
      </span>
      {recommended && (
        <CornerLabel
          label={t(($) => $['firstEmpty.recommended'])}
          className="absolute top-0 right-0 z-5"
          cornerClassName="text-util-colors-indigo-indigo-100"
          labelClassName="-ml-px rounded-tr-xl bg-util-colors-indigo-indigo-100 pr-2"
          textClassName="text-util-colors-indigo-indigo-700"
        />
      )}
    </button>
  )
}

function EmptyState({ canConnect, canCreate }: { canConnect: boolean; canCreate: boolean }) {
  const { t } = useTranslation('dataset')
  const { push } = useRouter()
  const canStart = canConnect || canCreate

  return (
    <div className="relative min-h-[calc(100vh-134px)] overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 grid auto-rows-[209px] grid-cols-1 gap-3 [mask-image:linear-gradient(to_bottom,black_0%,black_68%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_68%,transparent_100%)] md:grid-cols-2 xl:grid-cols-4"
      >
        {EMPTY_CARD_IDS.map((id) => (
          <div
            key={id}
            data-testid="empty-knowledge-card"
            className="h-[209px] rounded-xl border-[0.5px] border-components-card-border bg-gradient-to-b from-components-card-bg to-background-default-subtle shadow-xs"
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-background-body/70 backdrop-blur-[2px]" />
      <div className="relative z-10 flex min-h-[calc(100vh-134px)] translate-y-3 items-center justify-center px-6 py-16 text-center">
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
                  onClick={() => push('/datasets/new/create?mode=source')}
                />
              )}
              {canCreate && (
                <EmptyAction
                  iconClassName="i-ri-file-text-line"
                  title={t(($) => $['newKnowledge.uploadFiles'])}
                  description={t(($) => $['newKnowledge.uploadFilesDescription'])}
                  onClick={() => push('/datasets/new/create?mode=upload')}
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
                    onClick={() => push('/datasets/new/create?mode=empty')}
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
    </div>
  )
}

function DisabledMetadataFilter({ label }: { label: ReactNode }) {
  const { t } = useTranslation('dataset')

  return (
    <button
      type="button"
      disabled
      title={t(($) => $['newKnowledge.filtersUnavailable'])}
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
  const { push } = useRouter()
  const [query, setQuery] = useQueryState('q', parseAsString.withDefault(''))
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreate = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnect = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const showCreateMenu = canCreate || canConnect
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
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredKnowledgeSpaces = normalizedQuery
    ? knowledgeSpaces.filter((space) =>
        [space.name, space.description, space.slug].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : knowledgeSpaces

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      <header className="sticky top-0 z-10 flex flex-col gap-[14px] bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 items-center gap-2">
          <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">
            {t(($) => $.knowledge)}
          </h1>
          {viewSwitcher}
          <div className="flex-1" />
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
            <DisabledMetadataFilter label={t(($) => $['newKnowledge.tags'])} />
            <DisabledMetadataFilter label={t(($) => $['newKnowledge.creators'])} />
            <SearchInput
              className="w-[200px]"
              value={query}
              onValueChange={(value) => void setQuery(value || null)}
            />
          </div>
          {showCreateMenu && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button variant="primary" size="medium" className="gap-0.5 px-2 shadow-xs">
                    <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                    <span className="pl-1">{tCommon(($) => $['operation.create'])}</span>
                    <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
                  </Button>
                }
              />
              <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-72">
                {canConnect && (
                  <DropdownMenuItem onClick={() => push('/datasets/new/create?mode=source')}>
                    <span
                      aria-hidden
                      className="i-custom-vender-solid-development-api-connection-mod size-4 shrink-0"
                    />
                    <span>{t(($) => $['newKnowledge.connectSource'])}</span>
                  </DropdownMenuItem>
                )}
                {canConnect && canCreate && <DropdownMenuSeparator />}
                {canCreate && (
                  <>
                    <DropdownMenuItem onClick={() => push('/datasets/new/create?mode=upload')}>
                      <span aria-hidden className="i-ri-file-upload-line size-4 shrink-0" />
                      <span>{t(($) => $['newKnowledge.uploadFiles'])}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => push('/datasets/new/create?mode=empty')}>
                      <span aria-hidden className="i-ri-folder-line size-4 shrink-0" />
                      <span>{t(($) => $['newKnowledge.startEmpty'])}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <div className="px-8 pt-2 pb-8">
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
        ) : filteredKnowledgeSpaces.length === 0 ? (
          <PageState
            title={t(($) => $['filterEmpty.noKnowledge'])}
            description={t(($) => $['newKnowledge.noSearchResults'])}
          />
        ) : (
          <>
            <ul
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
              aria-label={t(($) => $.knowledge)}
            >
              {filteredKnowledgeSpaces.map((knowledgeSpace) => (
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
