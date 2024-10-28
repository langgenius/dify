'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import List from './index'

interface ListWrapperProps {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
}
const ListWrapper = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
}: ListWrapperProps) => {
  return (
    <List
      marketplaceCollections={marketplaceCollections}
      marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
    />
  )
}

export default ListWrapper
