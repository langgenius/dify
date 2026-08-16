'use client'

import type { MarketplaceCollection, SearchParamsFromCollection } from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { getLanguage } from '@/i18n-config/language'
import { useMarketplaceMoreClick } from '../atoms'
import { buildCarouselPages } from '../utils'
import CardWrapper from './card-wrapper'
import Carousel from './carousel'
import { GRID_CLASS } from './collection-constants'
import { useCarouselItemsPerPage } from './use-carousel-items-per-page'

const BECOME_PARTNER_URL = 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk'
const PARTNERS_COLLECTION_NAMES = new Set(['partners', 'partner-template', 'Partner Template'])
const COLLECTION_PRELOAD_MARGIN = '320px 0px'
const COLLECTION_INTERSECTION_THRESHOLD = 0.01
const MAX_PLACEHOLDER_CARDS = 8

type ListWithCollectionProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  onCollectionMoreClick?: (searchParams?: SearchParamsFromCollection) => void
  installedPluginIds?: ReadonlySet<string>
  deferOffscreenCollections?: boolean
}

type PluginCardProps = {
  plugin: Plugin
  showInstallButton?: boolean
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  isInstalled?: boolean
  linkToMarketplaceDetail?: boolean
}

const PluginCard = ({
  plugin,
  showInstallButton,
  cardRender,
  isInstalled,
  linkToMarketplaceDetail,
}: PluginCardProps) => {
  if (cardRender) return cardRender(plugin)

  return (
    <CardWrapper
      plugin={plugin}
      showInstallButton={showInstallButton}
      isInstalled={isInstalled}
      linkToMarketplaceDetail={linkToMarketplaceDetail}
    />
  )
}

type CollectionSectionProps = {
  collection: MarketplaceCollection
  plugins: Plugin[]
  itemsPerPage: number
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  onMoreClick: (searchParams?: SearchParamsFromCollection) => void
  installedPluginIds?: ReadonlySet<string>
  deferMount: boolean
}

const CollectionPlaceholder = ({
  cardContainerClassName,
  count,
}: {
  cardContainerClassName?: string
  count: number
}) => (
  <div
    aria-hidden
    className={cn('mt-2', GRID_CLASS, cardContainerClassName)}
    data-marketplace-collection-placeholder
  >
    {Array.from({ length: count }, (_, index) => (
      <div
        key={index}
        className="h-[148px] min-w-0 rounded-xl border border-components-panel-border-subtle bg-background-default-subtle"
      />
    ))}
  </div>
)

const CollectionSection = ({
  collection,
  plugins,
  itemsPerPage,
  showInstallButton,
  linkToMarketplaceDetail,
  cardContainerClassName,
  cardRender,
  onMoreClick,
  installedPluginIds,
  deferMount,
}: CollectionSectionProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const sectionRef = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(!deferMount)
  const pages = useMemo(() => buildCarouselPages(plugins, itemsPerPage), [itemsPerPage, plugins])
  const hasMultiplePages = pages.length > 1
  const isPartnersCollection = PARTNERS_COLLECTION_NAMES.has(collection.name)

  useEffect(() => {
    if (!deferMount || isMounted) return

    const section = sectionRef.current
    if (!section) return

    if (typeof IntersectionObserver === 'undefined') {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- This is the hydration fallback for browsers without IntersectionObserver.
      setIsMounted(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return

        setIsMounted(true)
        observer.disconnect()
      },
      {
        root: document.getElementById('marketplace-container'),
        rootMargin: COLLECTION_PRELOAD_MARGIN,
        threshold: COLLECTION_INTERSECTION_THRESHOLD,
      },
    )

    observer.observe(section)

    return () => observer.disconnect()
  }, [deferMount, isMounted])

  const carouselPages = useMemo(
    () =>
      pages.map((pageItems, pageIndex) => ({
        id: `${collection.name}-${itemsPerPage}-${pageIndex}`,
        content: (
          <div className={cn(GRID_CLASS, cardContainerClassName)}>
            {pageItems.map((plugin) => (
              <div key={plugin.plugin_id} className="min-w-0 *:w-full">
                <PluginCard
                  plugin={plugin}
                  showInstallButton={showInstallButton}
                  linkToMarketplaceDetail={linkToMarketplaceDetail}
                  cardRender={cardRender}
                  isInstalled={installedPluginIds?.has(plugin.plugin_id)}
                />
              </div>
            ))}
          </div>
        ),
      })),
    [
      cardContainerClassName,
      cardRender,
      collection.name,
      installedPluginIds,
      itemsPerPage,
      linkToMarketplaceDetail,
      pages,
      showInstallButton,
    ],
  )

  return (
    <div ref={sectionRef} className="py-3" data-marketplace-collection={collection.name}>
      <div className="flex items-end justify-between">
        <div>
          <div className="title-xl-semi-bold text-text-primary">
            {collection.label[getLanguage(locale)]}
          </div>
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
                  <span>{t(($) => $['marketplace.becomePartner'], { ns: 'plugin' })}</span>
                  <span aria-hidden className="i-ri-external-link-line size-3" />
                </a>
              </>
            )}
          </div>
        </div>
        {collection.searchable && !hasMultiplePages && (
          <button
            type="button"
            className="flex cursor-pointer items-center system-xs-medium text-text-accent"
            onClick={() => onMoreClick(collection.search_params)}
          >
            {t(($) => $['marketplace.viewMore'], { ns: 'plugin' })}
            <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
          </button>
        )}
      </div>
      {!isMounted ? (
        <CollectionPlaceholder
          cardContainerClassName={cardContainerClassName}
          count={Math.min(plugins.length, itemsPerPage, MAX_PLACEHOLDER_CARDS)}
        />
      ) : hasMultiplePages ? (
        <Carousel
          pages={carouselPages}
          ariaLabel={collection.label[getLanguage(locale)]}
          className="mt-2"
          showNavigation
          showPagination
          autoPlay
          autoPlayInterval={5000}
          deferMountPages={deferMount}
          pauseWhenOffscreen={deferMount}
        />
      ) : (
        <div className={cn('mt-2', GRID_CLASS, cardContainerClassName)}>
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.plugin_id}
              plugin={plugin}
              showInstallButton={showInstallButton}
              linkToMarketplaceDetail={linkToMarketplaceDetail}
              cardRender={cardRender}
              isInstalled={installedPluginIds?.has(plugin.plugin_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ListWithCollection = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  showInstallButton,
  linkToMarketplaceDetail,
  cardContainerClassName,
  cardRender,
  onCollectionMoreClick,
  installedPluginIds,
  deferOffscreenCollections = false,
}: ListWithCollectionProps) => {
  const defaultOnMoreClick = useMarketplaceMoreClick()
  const handleMoreClick = onCollectionMoreClick ?? defaultOnMoreClick
  const itemsPerPage = useCarouselItemsPerPage()

  return marketplaceCollections
    .filter((collection) => marketplaceCollectionPluginsMap[collection.name]?.length)
    .map((collection, index) => (
      <CollectionSection
        key={collection.name}
        collection={collection}
        plugins={marketplaceCollectionPluginsMap[collection.name]!}
        itemsPerPage={itemsPerPage}
        showInstallButton={showInstallButton}
        linkToMarketplaceDetail={linkToMarketplaceDetail}
        cardContainerClassName={cardContainerClassName}
        cardRender={cardRender}
        onMoreClick={handleMoreClick}
        installedPluginIds={installedPluginIds}
        // The first collection is above-the-fold content: it must render its
        // cards in the server-rendered HTML so a direct visit shows real
        // content without waiting for client-side JS. Only collections below
        // it defer to the IntersectionObserver.
        deferMount={deferOffscreenCollections && index > 0}
      />
    ))
}

export default ListWithCollection
