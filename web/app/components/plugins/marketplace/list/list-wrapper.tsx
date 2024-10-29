'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import { useMarketplaceContext } from '../context'
import List from './index'
import SortDropdown from '../sort-dropdown'

type ListWrapperProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
}
const ListWrapper = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
}: ListWrapperProps) => {
  const plugins = useMarketplaceContext(s => s.plugins)

  return (
    <div className='px-12 py-2 bg-background-default-subtle'>
      <div className='flex items-center'>
        <div className='title-xl-semi-bold text-text-primary'>134 results</div>
        <div className='mx-3 w-[1px] h-3.5 bg-divider-regular'></div>
        <SortDropdown />
      </div>
      <List
        marketplaceCollections={marketplaceCollections}
        marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
        plugins={plugins}
      />
    </div>
  )
}

export default ListWrapper
