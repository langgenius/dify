'use client'

import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import type { Plugin } from '../types'
import type { EmbeddedMarketplaceCategory } from './category-marketplace'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import ProviderCard from '@/app/components/plugins/provider-card'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { getCategoryMarketplaceId } from './category-marketplace'

const MARKETPLACE_PAGE_SIZE = 30

const CategoryMarketplacePanel = ({
  category,
  searchText,
  tags = [],
}: {
  category: EmbeddedMarketplaceCategory
  searchText: string
  tags?: string[]
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const [collapsed, setCollapsed] = useState(false)
  const {
    data: installedPluginIds,
    isError: hasInstalledPluginIdsError,
    isFetching: isFetchingInstalledPluginIds,
    isPending: isLoadingInstalledPluginIds,
    refetch: refetchInstalledPluginIds,
  } = useQuery({
    ...consoleQuery.workspaces.current.plugin.installedIds.get.queryOptions({
      input: { query: { category } },
    }),
    select: (data) => data.plugin_ids,
  })
  const hasLoadedInstalledPluginIds = installedPluginIds !== undefined
  const marketplaceSearchParams = useMemo<PluginsSearchParams | undefined>(() => {
    if (!hasLoadedInstalledPluginIds || collapsed) return undefined

    return {
      category,
      exclude: installedPluginIds ?? [],
      page_size: MARKETPLACE_PAGE_SIZE,
      query: searchText,
      sort_by: 'install_count',
      sort_order: 'DESC',
      ...(tags.length ? { tags } : {}),
      type: 'plugin',
    }
  }, [category, collapsed, hasLoadedInstalledPluginIds, installedPluginIds, searchText, tags])
  const { data, isPending, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useMarketplacePlugins(marketplaceSearchParams)
  const plugins = useMemo(
    () =>
      data?.pages
        .flatMap((page) => page.plugins)
        .filter((plugin) => !installedPluginIds?.includes(plugin.plugin_id)),
    [data, installedPluginIds],
  )

  const marketplaceLink = getMarketplaceCategoryUrl(category, { theme })
  const showInstalledPluginIdsError = hasInstalledPluginIdsError && !hasLoadedInstalledPluginIds
  const showLoading = isLoadingInstalledPluginIds || !!(marketplaceSearchParams && isPending)
  const cardRender = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle') return null

    return <ProviderCard key={plugin.plugin_id} className="h-36.5" payload={plugin} />
  }, [])

  return (
    <section
      className="flex scroll-mt-4 flex-col gap-2 pb-2"
      id={getCategoryMarketplaceId(category)}
    >
      <Divider className="my-2! h-px" />
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left system-md-semibold text-text-primary"
          onClick={() => setCollapsed((value) => !value)}
        >
          <span
            aria-hidden
            className={cn('i-ri-arrow-down-s-line size-4', collapsed && '-rotate-90')}
          />
          {t(($) => $['list.source.marketplace'], { ns: 'plugin' })}
        </button>
        <div className="flex items-center gap-1">
          <span className="system-sm-regular text-text-tertiary">
            {t(($) => $['modelProvider.discoverMore'], { ns: 'common' })}
          </span>
          <Link
            className="inline-flex items-center system-sm-medium text-text-accent"
            href={marketplaceLink}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
            <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
          </Link>
        </div>
      </div>
      {!collapsed && (
        <div>
          {showLoading && <Loading type="area" />}
          {showInstalledPluginIdsError && (
            <div className="flex flex-col items-center gap-2 py-4">
              <span className="system-sm-regular text-text-tertiary" role="alert">
                {t(($) => $['errorBoundary.title'], { ns: 'common' })}
              </span>
              <Button
                loading={isFetchingInstalledPluginIds}
                onClick={() => refetchInstalledPluginIds()}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </div>
          )}
          {!showLoading && !showInstalledPluginIdsError && (
            <List
              cardContainerClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              emptyClassName="h-auto"
              marketplaceCollections={[]}
              marketplaceCollectionPluginsMap={{}}
              plugins={plugins ?? []}
              showInstallButton={canInstallPlugin}
              cardRender={cardRender}
            />
          )}
          {!showLoading && hasNextPage && (
            <div className="flex justify-center py-4">
              <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                {t(($) => $['common.loadMore'], { ns: 'workflow' })}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default CategoryMarketplacePanel
