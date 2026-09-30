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
  const renderCandidate = (candidate: ResourceCandidate) => {
    const key = candidateKey(candidate)

    return (
      <div
        key={key}
        className="flex min-h-10 w-full items-center gap-3 border-b border-divider-subtle px-3 text-left last:border-b-0 hover:bg-state-base-hover"
      >
        <Checkbox
          checked={selectedResources.has(key)}
          aria-label={candidate.name}
          onCheckedChange={() => onToggle(candidate)}
        />
        <span
          aria-hidden
          className={
            candidate.type === 'app'
              ? 'i-ri-apps-2-line size-4 text-text-tertiary'
              : 'i-ri-book-2-line size-4 text-text-tertiary'
          }
        />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">
          {candidate.name}
        </span>
        <span className="system-xs-medium-uppercase text-text-tertiary">
          {candidate.type === 'app'
            ? t(($) => $['resourceAccessToken.app'], { ns: 'accountSettings' })
            : t(($) => $['resourceAccessToken.knowledge'], { ns: 'accountSettings' })}
        </span>
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
      <div>
        <div className="flex h-8 items-center border-b border-divider-subtle px-3 system-xs-medium-uppercase text-text-tertiary">
          {title}
        </div>
        {candidates.map(renderCandidate)}
        {renderLoadMoreButton(hasNextPage, isFetchingNextPage, fetchNextPage)}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
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
        <Tabs value={resourceTab} onValueChange={(value) => setResourceTab(value as ResourceTab)}>
          <div className="flex items-center justify-between gap-3">
            <TabsList className="gap-5">
              <TabsTab value="all" className="py-1.5 system-sm-semibold">
                {t(($) => $['resourceAccessToken.tabAll'], { ns: 'accountSettings' })}
              </TabsTab>
              <TabsTab value="app" className="py-1.5 system-sm-semibold">
                {t(($) => $['resourceAccessToken.tabApps'], { ns: 'accountSettings' })}
              </TabsTab>
              <TabsTab value="knowledge" className="py-1.5 system-sm-semibold">
                {t(($) => $['resourceAccessToken.tabKnowledgeBases'], {
                  ns: 'accountSettings',
                })}
              </TabsTab>
            </TabsList>
            <div className="rounded-full bg-state-accent-hover px-3 py-1 system-sm-semibold text-text-accent">
              {t(($) => $['dynamicSelect.selected'], {
                ns: 'common',
                count: selectedResources.size,
              })}
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-components-panel-border">
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
