'use client'
import type { MarketplaceCollection } from '../types'
import CardWrapper from './card-wrapper'
import type { Plugin } from '@/app/components/plugins/types'
import { getLanguage } from '@/i18n/language'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  locale: string
}
const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  locale,
}: ListWithCollectionProps) => {
  return (
    <>
      {
        marketplaceCollections.map(collection => (
          <div
            key={collection.name}
            className='py-3'
          >
            <div className='title-xl-semi-bold text-text-primary'>{collection.label[getLanguage(locale)]}</div>
            <div className='system-xs-regular text-text-tertiary'>{collection.description[getLanguage(locale)]}</div>
            <div className='grid grid-cols-4 gap-3 mt-2'>
              {
                marketplaceCollectionPluginsMap[collection.name].map(plugin => (
                  <CardWrapper
                    key={plugin.name}
                    plugin={plugin}
                    showInstallButton={showInstallButton}
                    locale={locale}
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
