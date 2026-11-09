'use client'

import type { ResourceCandidate } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import { candidateKey } from './resource-key'

type ResourceTab = 'all' | 'app' | 'knowledge'

export default function ResourceSelector({
  initialResources,
  selectedResources,
  onToggle,
}: {
  initialResources: ResourceCandidate[]
  selectedResources: ReadonlyMap<string, ResourceCandidate>
  onToggle: (candidate: ResourceCandidate) => void
}) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [resourceTab, setResourceTab] = useState<ResourceTab>('all')
  const [resourceSearchText, setResourceSearchText] = useState('')
  const debouncedResourceSearch = useDebounce(resourceSearchText.trim(), { wait: 300 })
  const appsQuery = useInfiniteQuery(
    consoleQuery.apps.get.infiniteOptions({
      input: (page) => ({
        query: {
          limit: 100,
          name: debouncedResourceSearch || undefined,
          openapi_visible: true,
          page: Number(page),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const datasetsQuery = useInfiniteQuery(
    consoleQuery.datasets.get.infiniteOptions({
      input: (page) => ({
        query: {
          include_all: true,
          keyword: debouncedResourceSearch || undefined,
          limit: 100,
          page: Number(page),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const appCandidates = useMemo<ResourceCandidate[]>(() => {
    const candidates: ResourceCandidate[] =
      appsQuery.data?.pages
        .flatMap((page) => page.data)
        .map((app) => ({
          id: app.id,
          name: app.name,
          type: 'app' as const,
        })) ?? []

    initialResources
      .filter((candidate) => candidate.type === 'app')
      .forEach((candidate) => {
        if (!candidates.some((item) => item.id === candidate.id)) candidates.push(candidate)
      })

    return candidates
  }, [appsQuery.data?.pages, initialResources])
  const knowledgeCandidates = useMemo<ResourceCandidate[]>(() => {
    const candidates: ResourceCandidate[] =
      datasetsQuery.data?.pages
        .flatMap((page) => page.data)
        .filter((dataset) => dataset.enable_api)
        .map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          type: 'knowledge' as const,
        })) ?? []

    initialResources
      .filter((candidate) => candidate.type === 'knowledge')
      .forEach((candidate) => {
        if (!candidates.some((item) => item.id === candidate.id)) candidates.push(candidate)
      })

    return candidates
  }, [datasetsQuery.data?.pages, initialResources])
  const resourceCandidates = useMemo(
    () => [...appCandidates, ...knowledgeCandidates],
    [appCandidates, knowledgeCandidates],
  )
  const filteredAppCandidates = useMemo(() => {
    const keyword = resourceSearchText.trim().toLowerCase()
    if (!keyword) return appCandidates

    return appCandidates.filter((candidate) => candidate.name.toLowerCase().includes(keyword))
  }, [appCandidates, resourceSearchText])
  const filteredKnowledgeCandidates = useMemo(() => {
    const keyword = resourceSearchText.trim().toLowerCase()
    if (!keyword) return knowledgeCandidates

    return knowledgeCandidates.filter((candidate) => candidate.name.toLowerCase().includes(keyword))
  }, [knowledgeCandidates, resourceSearchText])
  const renderCandidate = (
    candidate: ResourceCandidate,
    index: number,
    candidates: ResourceCandidate[],
  ) => {
    const key = candidateKey(candidate)

    return (
      <div
        key={key}
        className={`relative mx-2 my-0.5 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-state-base-hover ${index < candidates.length - 1 ? 'after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-px after:border-b after:border-divider-subtle' : ''}`}
      >
        <span
          aria-hidden
          className={
            candidate.type === 'app'
              ? 'i-ri-apps-2-line size-6 shrink-0 text-text-tertiary'
              : 'i-ri-book-2-line size-6 shrink-0 text-text-tertiary'
          }
        />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">
          {candidate.name}
        </span>
        <Checkbox
          checked={selectedResources.has(key)}
          aria-label={candidate.name}
          onCheckedChange={() => onToggle(candidate)}
        />
      </div>
    )
  }

  const renderLoadMoreButton = (
    hasNextPage: boolean,
    isFetchingNextPage: boolean,
    fetchNextPage: () => void,
  ) => {
    if (!hasNextPage) return null

    return (
      <div className="flex justify-center border-b border-divider-subtle p-2">
        <Button
          size="small"
          variant="tertiary"
          disabled={isFetchingNextPage}
          onClick={fetchNextPage}
        >
          {t(($) => $['resourceAccessToken.loadMore'], { ns: 'accountSettings' })}
        </Button>
      </div>
    )
  }

  const renderCandidateSection = (
    title: string,
    candidates: ResourceCandidate[],
    hasNextPage: boolean,
    isFetchingNextPage: boolean,
    fetchNextPage: () => void,
  ) => {
    if (!candidates.length && !hasNextPage) return null

    return (
      <div className="mt-2 border-t border-divider-regular pt-2 first:mt-0 first:border-t-0 first:pt-0">
        <div className="flex h-8 items-center px-4 system-xs-medium-uppercase text-text-tertiary">
          {title}
        </div>
        {candidates.map(renderCandidate)}
        {renderLoadMoreButton(hasNextPage, isFetchingNextPage, fetchNextPage)}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="system-sm-medium text-text-secondary">
        {t(($) => $['resourceAccessToken.resources'], { ns: 'accountSettings' })}
      </div>
      <div className="grid gap-3">
        <SearchInput
          value={resourceSearchText}
          onValueChange={setResourceSearchText}
          placeholder={t(($) => $['resourceAccessToken.searchResourcesPlaceholder'], {
            ns: 'accountSettings',
          })}
        />
        <Tabs
          className="grid gap-3"
          value={resourceTab}
          onValueChange={(value) => setResourceTab(value as ResourceTab)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="gap-2">
              <TabsTab
                value="all"
                className="rounded-lg border-b-0 px-3 py-1.5 system-sm-medium data-active:bg-state-base-active"
              >
                {t(($) => $['resourceAccessToken.tabAllTypes'], { ns: 'accountSettings' })}
              </TabsTab>
              <TabsTab
                value="app"
                className="rounded-lg border-b-0 px-3 py-1.5 system-sm-medium data-active:bg-state-base-active"
              >
                {t(($) => $['resourceAccessToken.tabApps'], { ns: 'accountSettings' })}
              </TabsTab>
              <TabsTab
                value="knowledge"
                className="rounded-lg border-b-0 px-3 py-1.5 system-sm-medium data-active:bg-state-base-active"
              >
                {t(($) => $['resourceAccessToken.tabKnowledgeBases'], {
                  ns: 'accountSettings',
                })}
              </TabsTab>
            </TabsList>
            <div className="shrink-0 rounded-full bg-state-accent-hover px-3 py-1 system-xs-semibold text-text-accent">
              {t(($) => $['dynamicSelect.selected'], {
                ns: 'common',
                count: selectedResources.size,
              })}
            </div>
          </div>
          <div className="max-h-[min(28rem,45dvh)] overflow-y-auto overscroll-contain rounded-lg border border-divider-subtle py-1">
            {(appsQuery.isPending || datasetsQuery.isPending) && (
              <div className="grid gap-2 p-3">
                <SkeletonRectangle className="h-8 w-full animate-pulse" />
                <SkeletonRectangle className="h-8 w-full animate-pulse" />
                <SkeletonRectangle className="h-8 w-full animate-pulse" />
              </div>
            )}
            {!appsQuery.isPending && !datasetsQuery.isPending && (
              <>
                <TabsPanel value="all">
                  {renderCandidateSection(
                    t(($) => $['resourceAccessToken.appsSection'], {
                      ns: 'accountSettings',
                    }),
                    filteredAppCandidates,
                    appsQuery.hasNextPage,
                    appsQuery.isFetchingNextPage,
                    () => void appsQuery.fetchNextPage(),
                  )}
                  {renderCandidateSection(
                    t(($) => $['resourceAccessToken.knowledgeBasesSection'], {
                      ns: 'accountSettings',
                    }),
                    filteredKnowledgeCandidates,
                    datasetsQuery.hasNextPage,
                    datasetsQuery.isFetchingNextPage,
                    () => void datasetsQuery.fetchNextPage(),
                  )}
                </TabsPanel>
                <TabsPanel value="app">
                  {filteredAppCandidates.map(renderCandidate)}
                  {renderLoadMoreButton(
                    appsQuery.hasNextPage,
                    appsQuery.isFetchingNextPage,
                    () => void appsQuery.fetchNextPage(),
                  )}
                </TabsPanel>
                <TabsPanel value="knowledge">
                  {filteredKnowledgeCandidates.map(renderCandidate)}
                  {renderLoadMoreButton(
                    datasetsQuery.hasNextPage,
                    datasetsQuery.isFetchingNextPage,
                    () => void datasetsQuery.fetchNextPage(),
                  )}
                </TabsPanel>
              </>
            )}
            {!appsQuery.isPending &&
              !datasetsQuery.isPending &&
              ((resourceTab === 'all' &&
                filteredAppCandidates.length === 0 &&
                filteredKnowledgeCandidates.length === 0) ||
                (resourceTab === 'app' && filteredAppCandidates.length === 0) ||
                (resourceTab === 'knowledge' && filteredKnowledgeCandidates.length === 0)) && (
                <div className="p-6 text-center system-sm-regular text-text-tertiary">
                  {resourceCandidates.length === 0
                    ? t(($) => $['resourceAccessToken.noResources'], {
                        ns: 'accountSettings',
                      })
                    : t(($) => $['resourceAccessToken.noResourceSearchResults'], {
                        ns: 'accountSettings',
                      })}
                </div>
              )}
          </div>
        </Tabs>
      </div>
    </div>
  )
}
