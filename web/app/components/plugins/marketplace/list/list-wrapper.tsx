'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import { useMarketplaceContext } from '../context'
import List from './index'

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
      <List
        marketplaceCollections={marketplaceCollections}
        marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
        plugins={plugins}
      />
    </div>
  )
}

export default ListWrapper
