'use client'

import type { MarketplaceCollection, SearchParamsFromCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { getLanguage } from '@/i18n-config/language'
import { useMarketplaceMoreClick } from '../atoms'
import { buildCarouselPages } from '../utils'
import CardWrapper from './card-wrapper'
import Carousel from './carousel'
import {
  CAROUSEL_BREAKPOINTS,
  CAROUSEL_PAGE_CLASS,
  CAROUSEL_PAGE_SIZE,
  GRID_CLASS,
} from './collection-constants'

const BECOME_PARTNER_URL = 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk'
const PARTNERS_COLLECTION_NAMES = new Set(['partners', 'partner-template', 'Partner Template'])

const getViewportWidth = () => typeof window === 'undefined' ? CAROUSEL_BREAKPOINTS.xl : window.innerWidth

const getCarouselItemsPerPage = (viewportWidth: number) => {
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.xl)
    return CAROUSEL_PAGE_SIZE.xl
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.lg)
    return CAROUSEL_PAGE_SIZE.lg
  if (viewportWidth >= CAROUSEL_BREAKPOINTS.sm)
    return CAROUSEL_PAGE_SIZE.sm

  return CAROUSEL_PAGE_SIZE.base
}

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  onCollectionMoreClick?: (searchParams?: SearchParamsFromCollection) => void
}

type PluginCardProps = {
  plugin: Plugin
  showInstallButton?: boolean
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
}

const PluginCard = ({
  plugin,
  showInstallButton,
  cardRender,
}: PluginCardProps) => {
  if (cardRender)
    return cardRender(plugin)

  return (
    <CardWrapper
      plugin={plugin}
      showInstallButton={showInstallButton}
    />
  )
}

const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  cardContainerClassName,
  cardRender,
  onCollectionMoreClick,
}: ListWithCollectionProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const defaultOnMoreClick = useMarketplaceMoreClick()
  const handleMoreClick = onCollectionMoreClick ?? defaultOnMoreClick
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth)
  const itemsPerPage = useMemo(() => getCarouselItemsPerPage(viewportWidth), [viewportWidth])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <>
      {
        marketplaceCollections.filter((collection) => {
          return marketplaceCollectionPluginsMap[collection.name]?.length
        }).map((collection) => {
          const plugins = marketplaceCollectionPluginsMap[collection.name]!
          const pages = buildCarouselPages(plugins, itemsPerPage)
          const hasMultiplePages = pages.length > 1
          const isPartnersCollection = PARTNERS_COLLECTION_NAMES.has(collection.name)

          return (
            <div
              key={collection.name}
              className="py-3"
            >
              <div className="flex items-end justify-between">
                <div>
                  <div className="title-xl-semi-bold text-text-primary">{collection.label[getLanguage(locale)]}</div>
                  <div className="flex items-center gap-x-2 system-xs-regular text-text-tertiary">
                    {collection.description[getLanguage(locale)]}
                    {isPartnersCollection && (
                      <>
                        <span className="text-divider-regular">|</span>
                        <a
                          href={BECOME_PARTNER_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-x-0.5 text-text-accent hover:underline"
                        >
                          <span>{t('marketplace.becomePartner', { ns: 'plugin' })}</span>
                          <span aria-hidden className="i-ri-external-link-line size-3" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
                {
                  collection.searchable && !hasMultiplePages && (
                    <div
                      className="flex cursor-pointer items-center system-xs-medium text-text-accent"
                      onClick={() => handleMoreClick(collection.search_params)}
                    >
                      {t('marketplace.viewMore', { ns: 'plugin' })}
                      <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
                    </div>
                  )
                }
              </div>
              {hasMultiplePages
                ? (
                    <Carousel
                      className="mt-2"
                      showNavigation
                      showPagination
                      autoPlay
                      autoPlayInterval={5000}
                    >
                      {pages.map(pageItems => (
                        <div
                          key={pageItems.map(plugin => plugin.plugin_id).join('-')}
                          className={CAROUSEL_PAGE_CLASS}
                          style={{ scrollSnapAlign: 'start' }}
                        >
                          <div className={cn(GRID_CLASS, cardContainerClassName)}>
                            {pageItems.map(plugin => (
                              <div
                                key={plugin.plugin_id}
                                className="min-w-0 [&>*]:w-full"
                              >
                                <PluginCard
                                  plugin={plugin}
                                  showInstallButton={showInstallButton}
                                  cardRender={cardRender}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </Carousel>
                  )
                : (
                    <div className={cn('mt-2', GRID_CLASS, cardContainerClassName)}>
                      {plugins.map(plugin => (
                        <PluginCard
                          key={plugin.plugin_id}
                          plugin={plugin}
                          showInstallButton={showInstallButton}
                          cardRender={cardRender}
                        />
                      ))}
                    </div>
                  )}
            </div>
          )
        })
      }
    </>
  )
}

export default ListWithCollection
