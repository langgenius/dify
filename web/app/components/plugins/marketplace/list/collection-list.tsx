'use client'

import type { SearchTab } from '../search-params'
import type { SearchParamsFromCollection } from '../types'
import type { BaseCollection } from './collection-constants'
import type { Locale } from '@/i18n-config/language'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { useEffect, useMemo, useState } from 'react'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'
import { useMarketplaceMoreClick } from '../atoms'
import Empty from '../empty'
import { buildCarouselPages, getItemKeyByField } from '../utils'
import Carousel from './carousel'
import {
  CAROUSEL_BREAKPOINTS,
  CAROUSEL_PAGE_CLASS,
  CAROUSEL_PAGE_GRID_CLASS,
  CAROUSEL_PAGE_SIZE,
  GRID_CLASS,
  GRID_DISPLAY_LIMIT,
} from './collection-constants'

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

type ViewMoreButtonProps = {
  searchParams?: SearchParamsFromCollection
  searchTab?: SearchTab
}

export function ViewMoreButton({ searchParams, searchTab }: ViewMoreButtonProps) {
  const { t } = useTranslation()
  const onMoreClick = useMarketplaceMoreClick()

  return (
    <div
      className="flex cursor-pointer items-center text-text-accent system-xs-medium"
      onClick={() => onMoreClick(searchParams, searchTab)}
    >
      {t('marketplace.viewMore', { ns: 'plugin' })}
      <RiArrowRightSLine className="h-4 w-4" />
    </div>
  )
}

type CollectionHeaderProps<TCollection extends BaseCollection> = {
  collection: TCollection
  itemsLength: number
  locale: Locale
  viewMore: React.ReactNode
}

export function CollectionHeader<TCollection extends BaseCollection>({
  collection,
  itemsLength,
  locale,
  viewMore,
}: CollectionHeaderProps<TCollection>) {
  const showViewMore = collection.searchable
    && !!collection.search_params
    && itemsLength > GRID_DISPLAY_LIMIT

  // The API only ships translations for a subset of locales (typically en_US
  // and zh_Hans). For any other locale (e.g. ja_JP, pt_BR) the keyed lookup
  // returns undefined and the title/description render as empty divs. Fall
  // back to the en_US translation, then to whatever value is available, so
  // the header always shows something meaningful.
  const lang = getLanguage(locale)
  const label = collection.label[lang] || collection.label.en_US || Object.values(collection.label)[0] || ''
  const description = collection.description[lang] || collection.description.en_US || Object.values(collection.description)[0] || ''

  return (
    <div className="mb-2 flex items-end justify-between">
      <div>
        <div className="text-text-primary title-xl-semi-bold">
          {label}
        </div>
        <div className="text-text-tertiary system-xs-regular">
          {description}
        </div>
      </div>
      {showViewMore && viewMore}
    </div>
  )
}

type CarouselCollectionProps<TItem> = {
  items: TItem[]
  getItemKey: (item: TItem) => string
  renderCard: (item: TItem) => React.ReactNode
  cardContainerClassName?: string
}

export function CarouselCollection<TItem>({
  items,
  getItemKey,
  renderCard,
  cardContainerClassName,
}: CarouselCollectionProps<TItem>) {
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth)

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const itemsPerPage = useMemo(() => getCarouselItemsPerPage(viewportWidth), [viewportWidth])
  const pages = useMemo(() => buildCarouselPages(items, itemsPerPage), [items, itemsPerPage])
  const hasMultiplePages = pages.length > 1

  return (
    <Carousel
      showNavigation={hasMultiplePages}
      showPagination={hasMultiplePages}
      autoPlay={hasMultiplePages}
      autoPlayInterval={5000}
    >
      {pages.map((pageItems, idx) => (
        <div
          key={pageItems[0] ? getItemKey(pageItems[0]) : idx}
          className={CAROUSEL_PAGE_CLASS}
          style={{ scrollSnapAlign: 'start' }}
        >
          <div className={cn(CAROUSEL_PAGE_GRID_CLASS, cardContainerClassName)}>
            {pageItems.map(item => (
              <div key={getItemKey(item)}>{renderCard(item)}</div>
            ))}
          </div>
        </div>
      ))}
    </Carousel>
  )
}

type CollectionListProps<TItem, TCollection extends BaseCollection> = {
  collections: TCollection[]
  collectionItemsMap: Record<string, TItem[]>
  /** Field name to use as item key (e.g. 'plugin_id', 'id'). */
  itemKeyField: keyof TItem
  renderCard: (item: TItem) => React.ReactNode
  /** Search tab for ViewMoreButton (e.g. 'templates' for template collections). */
  viewMoreSearchTab?: SearchTab
  gridClassName?: string
  cardContainerClassName?: string
  emptyClassName?: string
  emptyText?: string
}

function CollectionList<TItem, TCollection extends BaseCollection>({
  collections,
  collectionItemsMap,
  itemKeyField,
  renderCard,
  viewMoreSearchTab,
  gridClassName = GRID_CLASS,
  cardContainerClassName,
  emptyClassName,
  emptyText,
}: CollectionListProps<TItem, TCollection>) {
  const locale = useLocale()

  const collectionsWithItems = collections.filter((collection) => {
    return collectionItemsMap[collection.name]?.length
  })

  if (collectionsWithItems.length === 0) {
    return <Empty className={emptyClassName} text={emptyText} />
  }

  return (
    <>
      {
        collectionsWithItems.map((collection) => {
          const items = collectionItemsMap[collection.name]

          return (
            <div
              key={collection.name}
              className="py-3"
            >
              <CollectionHeader
                collection={collection}
                itemsLength={items.length}
                locale={locale}
                viewMore={<ViewMoreButton searchParams={collection.search_params} searchTab={viewMoreSearchTab} />}
              />
              {!collection.searchable
                ? (
                    <CarouselCollection
                      items={items}
                      getItemKey={item => getItemKeyByField(item, itemKeyField)}
                      renderCard={renderCard}
                      cardContainerClassName={cardContainerClassName}
                    />
                  )
                : (
                    <div className={cn(gridClassName, cardContainerClassName)}>
                      {items.slice(0, GRID_DISPLAY_LIMIT).map(item => (
                        <div key={getItemKeyByField(item, itemKeyField)}>
                          {renderCard(item)}
                        </div>
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

export default CollectionList
