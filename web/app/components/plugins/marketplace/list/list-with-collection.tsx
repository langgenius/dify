'use client'
import type { MarketplaceCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
}
const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
}: ListWithCollectionProps) => {
  return (
    <>
      {
        marketplaceCollections.map(collection => (
          <div
            key={collection.name}
            className='py-3'
          >
            <div className='title-xl-semi-bold text-text-primary'>{collection.name}</div>
            <div className='system-xs-regular text-text-tertiary'>{collection.description}</div>
            <div className='grid grid-cols-4 gap-3 mt-2'>
              {
                marketplaceCollectionPluginsMap[collection.name].map(plugin => (
                  <Card
                    key={plugin.name}
                    payload={plugin}
                    footer={
                      <CardMoreInfo
                        downloadCount={plugin.install_count}
                        tags={['Search', 'Productivity']}
                      />
                    }
                  />
                ))
              }
            </div>
          </div>
        ))
      }
    </>
  )
}

export default ListWithCollection
