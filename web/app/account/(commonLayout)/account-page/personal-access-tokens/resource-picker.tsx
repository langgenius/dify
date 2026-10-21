import type { PersonalAccessTokenResourceResponse } from '@dify/contracts/api/console/account/types.gen'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'

type ResourceFilter = 'all' | 'app' | 'dataset'

export default function ResourcePicker({
  selected,
  onToggle,
}: {
  selected: PersonalAccessTokenResourceResponse[]
  onToggle: (resource: PersonalAccessTokenResourceResponse) => void
}) {
  const { t } = useTranslation(['accountSettings', 'common', 'dataset'])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ResourceFilter>('all')
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(() => new Set())
  const keyword = useDebounce(search.trim(), { wait: 200 })
  const query = useInfiniteQuery(
    consoleQuery.account.personalAccessTokenResources.get.infiniteOptions({
      context: { silent: true },
      initialPageParam: 0,
      input: (cursor) => ({ query: { cursor, limit: 20, keyword } }),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  )
  const candidates = new Map(
    selected
      .filter((resource) =>
        [resource.display_name, resource.workspace_name, resource.resource_id].some((value) =>
          value.toLowerCase().includes(keyword.toLowerCase()),
        ),
      )
      .map((resource) => [`${resource.resource_type}:${resource.resource_id}`, resource]),
  )
  for (const page of query.data?.pages ?? []) {
    for (const resource of page.data) {
      candidates.set(`${resource.resource_type}:${resource.resource_id}`, resource)
      for (const runner of resource.app_runners ?? [])
        candidates.set(`${runner.resource_type}:${runner.resource_id}`, runner)
    }
  }

  const values = Array.from(candidates.values())
  const apps = values.filter((resource) => resource.resource_type === 'app')
  const datasets = values.filter((resource) => resource.resource_type === 'dataset')
  const orphanedRunners = values.filter(
    (resource) => resource.resource_type === 'app_runner' && !resource.parent_app_id,
  )
  const visibleApps = filter === 'dataset' ? [] : apps
  const visibleDatasets = filter === 'app' ? [] : datasets
  const visibleOrphanedRunners = filter === 'dataset' ? [] : orphanedRunners
  const visibleCount = visibleApps.length + visibleDatasets.length + visibleOrphanedRunners.length
  const isExpanded = (appId: string) => !collapsedApps.has(appId)

  const renderResource = (
    resource: PersonalAccessTokenResourceResponse,
    nested = false,
    displayName = resource.display_name,
    lastNested = false,
  ) => {
    const checked = selected.some(
      (item) =>
        item.resource_type === resource.resource_type && item.resource_id === resource.resource_id,
    )
    return (
      <div
        key={`${resource.resource_type}:${resource.resource_id}`}
        className={`relative flex min-h-10 items-center py-1.5 ${nested ? 'gap-0' : 'gap-3'}`}
      >
        {nested && (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 40"
            className="-ml-px h-10 w-6 shrink-0 overflow-visible text-divider-deep"
          >
            <path
              d={
                lastNested
                  ? 'M0 0 V14 C0 17.3 2.7 20 6 20 H24'
                  : 'M0 0 V40 M0 14 C0 17.3 2.7 20 6 20 H24'
              }
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
        {!nested && (
          <Avatar size="xs">
            <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onToggle(resource)}
                  disabled={!resource.available && !checked}
                  className="max-w-full truncate text-left system-sm-medium text-text-secondary focus-visible:outline-2"
                />
              }
            >
              {displayName}
            </TooltipTrigger>
            <TooltipContent>
              {resource.resource_type === 'app_runner' ? 'deployment_id' : 'ID'}:{' '}
              {resource.resource_id}
            </TooltipContent>
          </Tooltip>
          {!nested && (
            <p className="system-xs-regular break-words text-text-tertiary">
              {resource.resource_type === 'dataset'
                ? t(($) => $['resourceAccessToken.knowledge'])
                : resource.resource_type === 'app_runner'
                  ? t(($) => $['personalAccessToken.appRunner'])
                  : t(($) => $['resourceAccessToken.app'])}{' '}
              · {resource.workspace_name}
            </p>
          )}
        </div>
        {!resource.available && (
          <span className="system-xs-regular text-text-warning">
            {resource.reason === 'workspace_not_current'
              ? t(($) => $['personalAccessToken.workspaceNotCurrent'])
              : t(($) => $['personalAccessToken.accessRemoved'])}
          </span>
        )}
        <Checkbox
          checked={checked}
          disabled={!resource.available && !checked}
          aria-label={displayName}
          onCheckedChange={() => onToggle(resource)}
        />
      </div>
    )
  }

  const filters: { value: ResourceFilter; label: string }[] = [
    { value: 'all', label: t(($) => $['resourceAccessToken.tabAll']) },
    { value: 'app', label: t(($) => $['resourceAccessToken.tabApps']) },
    { value: 'dataset', label: t(($) => $['resourceAccessToken.tabKnowledgeBases']) },
  ]

  return (
    <div className="contents">
      <SearchInput
        value={search}
        onValueChange={setSearch}
        placeholder={t(($) => $['personalAccessToken.searchResources'])}
      />
      <div className="col-span-2 mt-2 flex flex-wrap items-center gap-1">
        <div
          role="group"
          aria-label={t(($) => $['resourceAccessToken.resources'])}
          className="flex gap-1"
        >
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`rounded-lg px-3 py-1.5 system-xs-medium ${filter === item.value ? 'bg-state-base-hover text-text-primary' : 'text-text-tertiary hover:bg-state-base-hover'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-2 max-h-64 overflow-y-auto rounded-lg border border-components-panel-border px-4 py-2">
        {visibleApps.length > 0 && (
          <section aria-label={t(($) => $['resourceAccessToken.appsSection'])}>
            <p className="mb-1 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['resourceAccessToken.appsSection'])}
            </p>
            <div className="-mx-4 divide-y divide-divider-subtle">
              {visibleApps.map((app) => (
                <div key={`app:${app.resource_id}`} className="px-4 py-2 first:pt-0 last:pb-0">
                  <div className="flex min-h-10 items-center gap-3 py-1.5">
                    <Avatar size="xs">
                      <AvatarFallback>{app.display_name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate system-sm-medium text-text-secondary">
                        {app.display_name}
                      </p>
                      <p className="truncate system-xs-regular text-text-tertiary">
                        {t(($) => $['personalAccessToken.workspace'])}: {app.workspace_name}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={app.display_name}
                      aria-expanded={isExpanded(app.resource_id)}
                      onClick={() =>
                        setCollapsedApps((current) => {
                          const next = new Set(current)
                          if (next.has(app.resource_id)) next.delete(app.resource_id)
                          else next.add(app.resource_id)
                          return next
                        })
                      }
                      className="rounded p-1 text-text-tertiary hover:bg-state-base-hover focus-visible:outline-2"
                    >
                      <span
                        aria-hidden="true"
                        className={`i-ri-arrow-${isExpanded(app.resource_id) ? 'down' : 'right'}-s-line size-4`}
                      />
                    </button>
                  </div>
                  {isExpanded(app.resource_id) && (
                    <div className="ml-3">
                      {renderResource(
                        app,
                        true,
                        t(($) => $['metadata.datasetMetadata.builtIn'], { ns: 'dataset' }),
                        (app.app_runners ?? []).length === 0,
                      )}
                      {(app.app_runners ?? []).map((runner, index, runners) =>
                        renderResource(
                          runner,
                          true,
                          runner.display_name.startsWith(`${app.display_name} / `)
                            ? runner.display_name.slice(app.display_name.length + 3)
                            : runner.display_name,
                          index === runners.length - 1,
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {visibleDatasets.length > 0 && (
          <section
            aria-label={t(($) => $['resourceAccessToken.knowledgeBasesSection'])}
            className={
              visibleApps.length > 0 ? '-mx-4 mt-2 border-t border-divider-subtle px-4 pt-2' : ''
            }
          >
            <p className="mb-1 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['resourceAccessToken.knowledgeBasesSection'])}
            </p>
            <div className="-mx-4 divide-y divide-divider-subtle">
              {visibleDatasets.map((dataset) => (
                <div
                  key={`dataset:${dataset.resource_id}`}
                  className="px-4 py-1.5 first:pt-0 last:pb-0"
                >
                  {renderResource(dataset)}
                </div>
              ))}
            </div>
          </section>
        )}

        {visibleOrphanedRunners.map((runner) => renderResource(runner))}
        {query.isPending && (
          <div
            className="flex min-h-40 flex-col items-center justify-center gap-1 text-center"
            aria-busy="true"
          >
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.loadingResources'])}
            </p>
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.selectionPreservedLoading'])}
            </p>
            <div className="mt-1 w-full max-w-68 space-y-1.5" aria-hidden="true">
              <div className="h-1.5 rounded-full bg-background-section" />
              <div className="h-1.5 rounded-full bg-background-section" />
              <div className="h-1.5 rounded-full bg-background-section" />
            </div>
          </div>
        )}
        {query.isError && (
          <div
            role="alert"
            className="flex min-h-40 flex-col items-center justify-center gap-1 text-center"
          >
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.couldNotLoadResources'])}
            </p>
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['resourceAccessToken.selectionPreservedError'])}
            </p>
            <button
              type="button"
              className="mt-1 system-xs-medium text-text-accent hover:underline focus-visible:outline-2"
              onClick={() => {
                if (query.isError) void query.refetch()
              }}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </button>
          </div>
        )}
        {!query.isPending && !query.isError && visibleCount === 0 && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
            <p className="system-xs-regular text-text-tertiary">
              {keyword
                ? t(($) => $['resourceAccessToken.noResourceSearchResults'])
                : t(($) => $['resourceAccessToken.noResourcesAvailable'])}
            </p>
            {!keyword && (
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['resourceAccessToken.resourcesWillAppearHere'])}
              </p>
            )}
          </div>
        )}
        {query.hasNextPage && (
          <div className="pt-2">
            <Button
              loading={query.isFetchingNextPage}
              onClick={() => {
                if (query.hasNextPage) void query.fetchNextPage()
              }}
            >
              {t(($) => $['resourceAccessToken.loadMore'])}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
