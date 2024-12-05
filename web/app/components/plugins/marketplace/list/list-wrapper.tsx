'use client'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import { useMarketplaceContext } from '../context'
import List from './index'
import SortDropdown from '../sort-dropdown'
import Loading from '@/app/components/base/loading'

type ListWrapperProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  locale: string
}
const ListWrapper = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  locale,
}: ListWrapperProps) => {
  const { t } = useTranslation()
  const plugins = useMarketplaceContext(v => v.plugins)
  const marketplaceCollectionsFromClient = useMarketplaceContext(v => v.marketplaceCollectionsFromClient)
  const marketplaceCollectionPluginsMapFromClient = useMarketplaceContext(v => v.marketplaceCollectionPluginsMapFromClient)
  const isLoading = useMarketplaceContext(v => v.isLoading)
  const isSuccessCollections = useMarketplaceContext(v => v.isSuccessCollections)
  const handleQueryPlugins = useMarketplaceContext(v => v.handleQueryPlugins)
  const page = useMarketplaceContext(v => v.page)

  useEffect(() => {
    if (!marketplaceCollectionsFromClient?.length && isSuccessCollections)
      handleQueryPlugins()
  }, [handleQueryPlugins, marketplaceCollections, marketplaceCollectionsFromClient, isSuccessCollections])

  return (
    <div className='relative flex flex-col grow px-12 py-2 bg-background-default-subtle'>
      {
        plugins && (
          <div className='top-5 flex items-center mb-4 pt-3'>
            <div className='title-xl-semi-bold text-text-primary'>{t('plugin.marketplace.pluginsResult', { num: plugins.length })}</div>
            <div className='mx-3 w-[1px] h-3.5 bg-divider-regular'></div>
            <SortDropdown />
          </div>
        )
      }
      {
        isLoading && page === 1 && (
          <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
            <Loading />
          </div>
        )
      }
      {
        (!isLoading || page > 1) && (
          <List
            marketplaceCollections={marketplaceCollectionsFromClient || marketplaceCollections}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMapFromClient || marketplaceCollectionPluginsMap}
            plugins={plugins}
            showInstallButton={showInstallButton}
            locale={locale}
          />
        )
      }
    </div>
  )
}

export default ListWrapper
