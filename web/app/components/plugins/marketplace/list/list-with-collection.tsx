'use client'

import { RiArrowRightSLine } from '@remixicon/react'
import type { MarketplaceCollection } from '../types'
import CardWrapper from './card-wrapper'
import type { Plugin } from '@/app/components/plugins/types'
import { getLanguage } from '@/i18n/language'
import cn from '@/utils/classnames'
import type { SearchParamsFromCollection } from '@/app/components/plugins/marketplace/types'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  locale: string
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => JSX.Element | null
  onMoreClick?: (searchParams?: SearchParamsFromCollection) => void
}
const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  locale,
  cardContainerClassName,
  cardRender,
  onMoreClick,
}: ListWithCollectionProps) => {
  const { t } = useMixedTranslation(locale)

  return (
    <>
      {
        marketplaceCollections.map(collection => (
          <div
            key={collection.name}
            className='py-3'
          >
            <div className='flex justify-between items-end'>
              <div>
                <div className='title-xl-semi-bold text-text-primary'>{collection.label[getLanguage(locale)]}</div>
                <div className='system-xs-regular text-text-tertiary'>{collection.description[getLanguage(locale)]}</div>
              </div>
              {
                collection.searchable && onMoreClick && (
                  <div
                    className='flex items-center system-xs-medium text-text-accent cursor-pointer '
                    onClick={() => onMoreClick?.(collection.search_params)}
                  >
                    {t('plugin.marketplace.viewMore')}
                    <RiArrowRightSLine className='w-4 h-4' />
                  </div>
                )
              }
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
                      key={plugin.plugin_id}
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
