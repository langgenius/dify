import type { PersonalAccessTokenResourceResponse } from '@dify/contracts/api/console/account/types.gen'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import TreeBranchLine from '@/app/components/base/tree-branch-line'
import { consoleQuery } from '@/service/console'
import PickerList from './picker-list'

type ResourceType = 'app' | 'dataset'

const resourceKey = (resource: PersonalAccessTokenResourceResponse) =>
  `${resource.resource_type}:${resource.resource_id}`

export default function ResourcePicker({
  selected,
  onToggle,
}: {
  selected: PersonalAccessTokenResourceResponse[]
  onToggle: (resource: PersonalAccessTokenResourceResponse) => void
}) {
  const { t } = useTranslation(['accountSettings', 'common', 'dataset'])
  const [search, setSearch] = useState('')
  const [resourceType, setResourceType] = useState<ResourceType>(() =>
    selected.length > 0 && selected.every((resource) => resource.resource_type === 'dataset')
      ? 'dataset'
      : 'app',
  )
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(() => new Set())
  const keyword = useDebounce(search.trim(), { wait: 200 })
  const query = useInfiniteQuery(
    consoleQuery.account.personalAccessTokenResources.get.infiniteOptions({
      context: { silent: true },
      initialPageParam: 0,
      input: (cursor) => ({ query: { cursor, limit: 20, keyword, resource_type: resourceType } }),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  )
  const selectedKeys = new Set(selected.map(resourceKey))
  const datasetCount = selected.filter((resource) => resource.resource_type === 'dataset').length
  const normalizedKeyword = keyword.toLowerCase()
  const candidates = new Map<string, PersonalAccessTokenResourceResponse>()
  for (const resource of selected) {
    const type = resource.resource_type === 'dataset' ? 'dataset' : 'app'
    if (
      type === resourceType &&
      [resource.display_name, resource.workspace_name, resource.resource_id].some((value) =>
        value.toLowerCase().includes(normalizedKeyword),
      )
    )
      candidates.set(resourceKey(resource), resource)
  }
  for (const page of query.data?.pages ?? []) {
    for (const resource of page.data) candidates.set(resourceKey(resource), resource)
  }

  const values = Array.from(candidates.values())
  const apps = values.filter((resource) => resource.resource_type === 'app')
  const datasets = values.filter((resource) => resource.resource_type === 'dataset')
  const nestedDeploymentIds = new Set(
    apps.flatMap((app) => (app.app_deployments ?? []).map((runner) => runner.resource_id)),
  )
  const standaloneDeployments = values.filter(
    (resource) =>
      resource.resource_type === 'app_deployment' && !nestedDeploymentIds.has(resource.resource_id),
  )
  const isExpanded = (appId: string) => !collapsedApps.has(appId)

  const renderResource = (
    resource: PersonalAccessTokenResourceResponse,
    nested = false,
    displayName = resource.display_name,
    lastNested = false,
  ) => {
    const checked = selectedKeys.has(resourceKey(resource))
    return (
      <div
        key={resourceKey(resource)}
        className={`relative flex items-center gap-3 py-1.5 ${nested ? 'min-h-13 ps-6' : 'min-h-10'}`}
      >
        {nested && <TreeBranchLine last={lastNested} />}
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
                  className="max-w-full truncate text-start system-sm-medium text-text-secondary focus-visible:outline-2"
                />
              }
            >
              {displayName}
            </TooltipTrigger>
            <TooltipContent>
              {resource.resource_type === 'app_deployment' ? 'deployment_id' : 'ID'}:{' '}
              {resource.resource_id}
            </TooltipContent>
          </Tooltip>
          {!nested && (
            <p className="system-xs-regular break-words text-text-tertiary">
              {resource.resource_type === 'dataset'
                ? t(($) => $['resourceAccessToken.tabKnowledgeBases'])
                : resource.resource_type === 'app_deployment'
                  ? t(($) => $['personalAccessToken.appDeployment'])
                  : t(($) => $['resourceAccessToken.tabApps'])}{' '}
              · {resource.workspace_name}
            </p>
          )}
        </div>
        {!resource.available && (
          <span className="system-xs-regular text-text-warning">
            {resource.reason === 'workspace_not_current'
              ? t(($) => $['personalAccessToken.workspaceNotCurrent'])
              : t(($) => $['personalAccessToken.deleted'])}
          </span>
        )}
        <Checkbox
          data-pat-picker-item=""
          checked={checked}
          disabled={!resource.available && !checked}
          aria-label={displayName}
          onCheckedChange={() => onToggle(resource)}
        />
      </div>
    )
  }

  const tabs = [
    {
      value: 'app',
      label: t(($) => $['resourceAccessToken.tabApps']),
      count: selected.length - datasetCount,
    },
    {
      value: 'dataset',
      label: t(($) => $['resourceAccessToken.tabKnowledgeBases']),
      count: datasetCount,
    },
  ] satisfies { value: ResourceType; label: string; count: number }[]

  return (
    <div className="contents">
      <SearchInput
        className="mt-2 sm:mt-0"
        value={search}
        onValueChange={setSearch}
        placeholder={t(($) => $['personalAccessToken.searchResources'])}
      />
      <Tabs
        className="col-span-full mt-2 min-w-0"
        value={resourceType}
        onValueChange={setResourceType}
      >
        <TabsList
          aria-label={t(($) => $['resourceAccessToken.resources'])}
          className="flex-wrap gap-1"
        >
          {tabs.map(({ value, label, count }) => (
            <TabsTab
              key={value}
              value={value}
              className="gap-1.5 rounded-lg border-b-0 px-3 py-1.5 system-xs-medium hover:bg-state-base-hover data-active:bg-state-base-hover"
            >
              {label}
              <span
                aria-hidden="true"
                className="min-w-4 rounded border border-divider-deep px-1 text-center system-2xs-medium text-text-tertiary tabular-nums"
              >
                {count}
              </span>
              <span className="sr-only">
                {t(($) => $['dynamicSelect.selected'], { ns: 'common', count })}
              </span>
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel key={resourceType} value={resourceType} tabIndex={-1}>
          <PickerList
            query={query}
            keyword={keyword}
            hasVisibleItems={candidates.size > 0}
            labels={{
              loading: t(($) => $['resourceAccessToken.loadingResources']),
              loadError: t(($) => $['resourceAccessToken.couldNotLoadResources']),
              empty: keyword
                ? t(($) => $['resourceAccessToken.noResourceSearchResults'])
                : t(($) => $['resourceAccessToken.noResourcesAvailable']),
              emptyHint: keyword
                ? undefined
                : t(($) => $['resourceAccessToken.resourcesWillAppearHere']),
              loadMore: t(($) => $['personalAccessToken.loadMoreResources']),
            }}
          >
            <div className="-mx-4 divide-y divide-divider-subtle">
              {apps.map((app) => (
                <div key={resourceKey(app)} className="px-4 py-2 first:pt-0 last:pb-0">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-pat-picker-item=""
                          aria-expanded={isExpanded(app.resource_id)}
                          onClick={() =>
                            setCollapsedApps((current) => {
                              const next = new Set(current)
                              if (next.has(app.resource_id)) next.delete(app.resource_id)
                              else next.add(app.resource_id)
                              return next
                            })
                          }
                          className="flex min-h-10 w-full items-center gap-3 rounded py-1.5 text-start focus-visible:outline-2"
                        />
                      }
                    >
                      <Avatar size="xs" render={<span />} aria-hidden="true">
                        <AvatarFallback render={<span />}>
                          {app.display_name.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate system-sm-medium text-text-secondary">
                          {app.display_name}
                        </span>
                        <span className="block truncate system-xs-regular text-text-tertiary">
                          {t(($) => $['personalAccessToken.workspace'])}: {app.workspace_name}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`ms-auto size-4 shrink-0 text-text-tertiary ${
                          isExpanded(app.resource_id)
                            ? 'i-ri-arrow-down-s-line'
                            : 'i-ri-arrow-right-s-line [&:dir(rtl)]:-scale-x-100'
                        }`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>ID: {app.resource_id}</TooltipContent>
                  </Tooltip>
                  {isExpanded(app.resource_id) && (
                    <div className="ms-3">
                      {renderResource(
                        app,
                        true,
                        t(($) => $['metadata.datasetMetadata.builtIn'], { ns: 'dataset' }),
                        (app.app_deployments ?? []).length === 0,
                      )}
                      {(app.app_deployments ?? []).map((runner, index, runners) =>
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
              {datasets.map((dataset) => (
                <div key={resourceKey(dataset)} className="px-4 py-1.5 first:pt-0 last:pb-0">
                  {renderResource(dataset)}
                </div>
              ))}
            </div>
            {standaloneDeployments.map((runner) => renderResource(runner))}
          </PickerList>
        </TabsPanel>
      </Tabs>
    </div>
  )
}
