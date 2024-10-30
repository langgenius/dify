'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import ListWithCollection from './list-with-collection'
import CardWrapper from './card-wrapper'
import Empty from '../empty'

type ListProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  plugins?: Plugin[]
  showInstallButton?: boolean
}
const List = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  plugins,
  showInstallButton,
}: ListProps) => {
  return (
    <>
      {
        !plugins && (
          <ListWithCollection
            marketplaceCollections={marketplaceCollections}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
            showInstallButton={showInstallButton}
          />
        )
      }
      {
        plugins && !!plugins.length && (
          <div className='grid grid-cols-4 gap-3'>
            {
              plugins.map(plugin => (
                <CardWrapper
                  key={plugin.name}
                  plugin={plugin}
                  showInstallButton={showInstallButton}
                />
              ))
            }
          </div>
        )
      }
      {
        plugins && !plugins.length && (
          <Empty />
        )
      }
    </>
  )
}

export default List
