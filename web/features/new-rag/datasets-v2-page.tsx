'use client'

import type { KnowledgeSpaceResponse } from '@dify/contracts/api/console/knowledge-spaces/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { CreateKnowledgeSpaceDialog } from './create-knowledge-space-dialog'

const PAGE_SIZE = 30

function KnowledgeSpaceSkeleton({ label }: { label: string }) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-44 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs shadow-shadow-shadow-3"
        >
          <SkeletonContainer className="h-full">
            <div className="flex items-center gap-3">
              <SkeletonRectangle className="size-10 animate-pulse rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonRectangle className="h-4 w-2/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/3 animate-pulse" />
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <SkeletonRectangle className="h-3 w-full animate-pulse" />
              <SkeletonRectangle className="h-3 w-4/5 animate-pulse" />
            </div>
          </SkeletonContainer>
        </div>
      ))}
    </div>
  )
}

function PageState({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-divider-subtle bg-background-default-subtle px-6 py-12 text-center">
      <span className="mb-4 i-ri-book-open-line size-7 text-text-quaternary" aria-hidden />
      <h2 className="system-md-semibold text-text-primary">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-120 system-sm-regular text-text-tertiary">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function KnowledgeSpaceCard({ knowledgeSpace }: { knowledgeSpace: KnowledgeSpaceResponse }) {
  return (
    <li className="min-h-44 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs shadow-shadow-shadow-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-components-panel-border bg-background-default-subtle">
          <span className="i-ri-book-2-line size-5 text-text-tertiary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate system-md-semibold text-text-primary">{knowledgeSpace.name}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-text-tertiary">
            {knowledgeSpace.slug}
          </p>
        </div>
      </div>
      {knowledgeSpace.description && (
        <p className="mt-5 line-clamp-3 system-sm-regular text-text-secondary">
          {knowledgeSpace.description}
        </p>
      )}
    </li>
  )
}

export function DatasetsV2Page() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isPending,
    refetch,
  } = useInfiniteQuery(
    consoleQuery.knowledgeSpaces.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    }),
  )

  const firstPage = data?.pages[0]
  const enabled = firstPage?.enabled ?? true
  const isInitialError = Boolean(error && !data)
  const knowledgeSpaces = data?.pages.flatMap((page) => page.data) ?? []
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')

  useDocumentTitle(t(($) => $.knowledge))

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background-body px-8 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[18px]/[21.6px] font-semibold text-text-primary">
            {t(($) => $.knowledge)}
          </h1>
          <span className="shrink-0 rounded-md border border-divider-subtle bg-background-default-subtle px-1.5 py-0.5 system-xs-medium text-text-tertiary">
            {t(($) => $['newRag.badge'])}
          </span>
        </div>
        {!isPending && !isInitialError && enabled && canCreateDataset && (
          <CreateKnowledgeSpaceDialog />
        )}
      </header>

      <div className="px-8 pt-2 pb-8">
        {isPending ? (
          <KnowledgeSpaceSkeleton label={tCommon(($) => $.loading)} />
        ) : isInitialError ? (
          <PageState
            title={t(($) => $.unknownError)}
            action={
              <Button type="button" onClick={() => void refetch()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            }
          />
        ) : !enabled ? (
          <PageState
            title={t(($) => $.unavailable)}
            description={t(($) => $['newRag.disabledDescription'])}
          />
        ) : knowledgeSpaces.length === 0 ? (
          <PageState
            title={t(($) => $['filterEmpty.noKnowledge'])}
            description={t(($) => $['newRag.emptyDescription'])}
          />
        ) : (
          <>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
              aria-label={t(($) => $.knowledge)}
            >
              {knowledgeSpaces.map((knowledgeSpace) => (
                <KnowledgeSpaceCard key={knowledgeSpace.id} knowledgeSpace={knowledgeSpace} />
              ))}
            </ul>
            {isFetchNextPageError ? (
              <div className="mt-6 flex items-center justify-center gap-3" role="alert">
                <p className="system-sm-regular text-text-secondary">{t(($) => $.unknownError)}</p>
                <Button
                  type="button"
                  loading={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            ) : hasNextPage ? (
              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  loading={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {t(($) => $['newRag.loadMore'])}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
