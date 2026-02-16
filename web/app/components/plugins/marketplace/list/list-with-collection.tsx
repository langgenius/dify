'use client'

import type { MarketplaceCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'
import { useMarketplaceMoreClick } from '../atoms'
import CardWrapper from './card-wrapper'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
}
const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  cardContainerClassName,
  cardRender,
}: ListWithCollectionProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const onMoreClick = useMarketplaceMoreClick()

  return (
    <>
      {
        marketplaceCollections.filter((collection) => {
          return marketplaceCollectionPluginsMap[collection.name]?.length
        }).map(collection => (
          <div
            key={collection.name}
            className="py-3"
          >
            <div className="flex items-end justify-between">
              <div>
                <div className="title-xl-semi-bold text-text-primary">{collection.label[getLanguage(locale)]}</div>
                <div className="system-xs-regular text-text-tertiary">{collection.description[getLanguage(locale)]}</div>
              </div>
              {
                collection.searchable && (
                  <div
                    className="system-xs-medium flex cursor-pointer items-center text-text-accent "
                    onClick={() => onMoreClick(collection.search_params)}
                  >
                    {t('marketplace.viewMore', { ns: 'plugin' })}
                    <RiArrowRightSLine className="h-4 w-4" />
                  </div>
                )
              }
            </div>
            <div className={cn(
              'mt-2 grid grid-cols-4 gap-3',
              cardContainerClassName,
            )}
            >
              {
                marketplaceCollectionPluginsMap[collection.name].map((plugin) => {
                  if (cardRender)
                    return cardRender(plugin)

                  return (
                    <CardWrapper
                      key={plugin.plugin_id}
                      plugin={plugin}
                      showInstallButton={showInstallButton}
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
