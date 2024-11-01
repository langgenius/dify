'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import { useMarketplaceContext } from '../context'
import List from './index'
import SortDropdown from '../sort-dropdown'

type ListWrapperProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
}
const ListWrapper = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
}: ListWrapperProps) => {
  const plugins = useMarketplaceContext(v => v.plugins)
  const marketplaceCollectionsFromClient = useMarketplaceContext(v => v.marketplaceCollectionsFromClient)
  const marketplaceCollectionPluginsMapFromClient = useMarketplaceContext(v => v.marketplaceCollectionPluginsMapFromClient)

  return (
    <div className='px-12 py-2 bg-background-default-subtle'>
      {
        plugins && (
          <div className='flex items-center mb-4 pt-3'>
            <div className='title-xl-semi-bold text-text-primary'>{plugins.length} results</div>
            <div className='mx-3 w-[1px] h-3.5 bg-divider-regular'></div>
            <SortDropdown />
          </div>
        )
      }
      <List
        marketplaceCollections={marketplaceCollectionsFromClient || marketplaceCollections}
        marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMapFromClient || marketplaceCollectionPluginsMap}
        plugins={plugins}
        showInstallButton={showInstallButton}
      />
    </div>
  )
}

export default ListWrapper
