'use client'

import type { MarketplaceCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import { useMarketplaceMoreClick } from '../atoms'
import CardWrapper from './card-wrapper'
import Carousel from './carousel'

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
}

const PARTNERS_COLLECTION_NAME = 'partners'
const GRID_DISPLAY_LIMIT = 8 // show up to 8 items

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

  const renderPluginCard = (plugin: Plugin) => {
    if (cardRender)
      return cardRender(plugin)

    return (
      <CardWrapper
        plugin={plugin}
        showInstallButton={showInstallButton}
      />
    )
  }

  const renderPartnersCarousel = (collection: MarketplaceCollection, plugins: Plugin[]) => {
    // Partners collection: 2-row carousel with auto-play
    const rows: Plugin[][] = []
    for (let i = 0; i < plugins.length; i += 2) {
      // Group plugins in pairs (2 per column)
      rows.push(plugins.slice(i, i + 2))
    }

    return (
      <Carousel
        className={cardContainerClassName}
        showNavigation={plugins.length > 8}
        showPagination={plugins.length > 8}
        autoPlay={plugins.length > 8}
        autoPlayInterval={5000}
      >
        {rows.map(columnPlugins => (
          <div
            key={`column-${columnPlugins[0]?.plugin_id}`}
            className="flex w-[calc((100%-0px)/1)] shrink-0 flex-col gap-3 sm:w-[calc((100%-12px)/2)] lg:w-[calc((100%-24px)/3)] xl:w-[calc((100%-36px)/4)]"
            style={{ scrollSnapAlign: 'start' }}
          >
            {columnPlugins.map(plugin => (
              <div key={plugin.plugin_id}>
                {renderPluginCard(plugin)}
              </div>
            ))}
          </div>
        ))}
      </Carousel>
    )
  }

  const renderGridCollection = (collection: MarketplaceCollection, plugins: Plugin[]) => {
    // Other collections: responsive grid
    const displayPlugins = plugins.slice(0, GRID_DISPLAY_LIMIT)

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayPlugins.map(plugin => (
          <div key={plugin.plugin_id}>
            {renderPluginCard(plugin)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      {
        marketplaceCollections.filter((collection) => {
          return marketplaceCollectionPluginsMap[collection.name]?.length
        }).map((collection) => {
          const plugins = marketplaceCollectionPluginsMap[collection.name]
          const isPartnersCollection = collection.name === PARTNERS_COLLECTION_NAME
          const showViewMore = collection.searchable && (isPartnersCollection || plugins.length > GRID_DISPLAY_LIMIT)

          return (
            <div
              key={collection.name}
              className="py-3"
            >
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <div className="title-xl-semi-bold text-text-primary">{collection.label[getLanguage(locale)]}</div>
                  <div className="system-xs-regular text-text-tertiary">{collection.description[getLanguage(locale)]}</div>
                </div>
                {showViewMore && (
                  <div
                    className="system-xs-medium flex cursor-pointer items-center text-text-accent"
                    onClick={() => onMoreClick(collection.search_params)}
                  >
                    {t('marketplace.viewMore', { ns: 'plugin' })}
                    <RiArrowRightSLine className="h-4 w-4" />
                  </div>
                )}
              </div>
              {isPartnersCollection
                ? renderPartnersCarousel(collection, plugins)
                : renderGridCollection(collection, plugins)}
            </div>
          )
        })
      }
    </>
  )
}

export default ListWithCollection
