'use client'
import type { MarketplaceCollection } from '../types'
import CardWrapper from './card-wrapper'
import type { Plugin } from '@/app/components/plugins/types'
import { getLanguage } from '@/i18n/language'
import cn from '@/utils/classnames'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  locale: string
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => JSX.Element | null
  onMoreClick?: () => void
}
const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  locale,
  cardContainerClassName,
  cardRender,
  // onMoreClick,
}: ListWithCollectionProps) => {
  return (
    <>
      {
        marketplaceCollections.map(collection => (
          <div
            key={collection.name}
            className='py-3'
          >
            <div className='flex justify-between'>
              <div>
                <div className='title-xl-semi-bold text-text-primary'>{collection.label[getLanguage(locale)]}</div>
                <div className='system-xs-regular text-text-tertiary'>{collection.description[getLanguage(locale)]}</div>
              </div>
              {/* <div
                className='system-xs-regular text-text-tertiary cursor-pointer hover:underline'
                onClick={() => onMoreClick?.()}
              >more</div> */}
            </div>
            <div className={cn(
              'grid grid-cols-4 gap-3 mt-2',
              cardContainerClassName,
            )}>
              {
                marketplaceCollectionPluginsMap[collection.name].map((plugin) => {
                  if (cardRender)
                    return cardRender(plugin)

                  return (
                    <CardWrapper
                      key={plugin.name}
                      plugin={plugin}
                      showInstallButton={showInstallButton}
                      locale={locale}
                    />
                  )
                })
              }
            </div>
          </div>
        ))
      }
    </>
  )
}

export default ListWithCollection
