'use client'

import type { PluginsSearchParams } from '@dify/contracts/marketplace'
import type { Plugin } from '../types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTheme } from 'next-themes'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import MarketplaceList from '@/app/components/plugins/marketplace/list'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import ProviderCard from '@/app/components/plugins/provider-card'
import Link from '@/next/link'

type InstallFromMarketplaceProps = {
  canInstall: boolean
  category: PluginCategoryEnum
  installedPluginIds: string[]
  onOpenMarketplace?: () => void
  searchText: string
  tags: string[]
}

const InstallFromMarketplace = ({
  canInstall,
  category,
  installedPluginIds,
  onOpenMarketplace,
  searchText,
  tags,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const queryParams = useMemo<PluginsSearchParams>(
    () => ({
      category,
      exclude: installedPluginIds,
      page_size: 1000,
      query: searchText,
      sort_by: 'install_count',
      sort_order: 'DESC',
      tags,
      type: 'plugin',
    }),
    [category, installedPluginIds, searchText, tags],
  )
  const { data, isPending } = useMarketplacePlugins(queryParams)
  const plugins = useMemo(() => data?.pages.flatMap((page) => page.plugins) ?? [], [data?.pages])
  const renderCard = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle') return null

    return <ProviderCard key={plugin.plugin_id} className="h-[146px]" payload={plugin} />
  }, [])

  return (
    <div className="mb-2">
      <Divider className="mt-4! h-px" />
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left system-md-semibold text-text-primary"
          onClick={() => setCollapsed((value) => !value)}
        >
          <span
            aria-hidden="true"
            className={cn('i-ri-arrow-down-s-line size-4', collapsed && '-rotate-90')}
          />
          {t(($) => $['marketplace.moreFrom'], { ns: 'plugin' })}
        </button>
        <div className="mb-2 flex items-center pt-2">
          <span className="pr-1 system-sm-regular text-text-tertiary">
            {t(($) => $['modelProvider.discoverMore'], { ns: 'common' })}
          </span>
          {onOpenMarketplace ? (
            <button
              type="button"
              className="inline-flex items-center border-0 bg-transparent p-0 system-sm-medium text-text-accent"
              onClick={onOpenMarketplace}
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span className="i-ri-arrow-right-up-line size-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={getMarketplaceCategoryUrl(category, { theme })}
              className="inline-flex items-center system-sm-medium text-text-accent"
            >
              {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
              <span className="i-ri-arrow-right-up-line size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {!collapsed && isPending && <Loading type="area" />}
      {!collapsed && !isPending && (
        <MarketplaceList
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={plugins}
          showInstallButton={canInstall}
          cardContainerClassName="grid grid-cols-3 gap-2"
          cardRender={renderCard}
          emptyClassName="h-auto"
        />
      )}
    </div>
  )
}

export default memo(InstallFromMarketplace)
