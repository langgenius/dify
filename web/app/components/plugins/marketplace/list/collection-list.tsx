'use client'

import type { SearchTab } from '../search-params'
import type { SearchParamsFromCollection } from '../types'
import type { Locale } from '@/i18n-config/language'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'
import { useMarketplaceMoreClick } from '../atoms'
import { getItemKeyByField } from '../utils'
import Empty from '../empty'
import Carousel from './carousel'

export const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const GRID_DISPLAY_LIMIT = 8

export const CAROUSEL_COLUMN_CLASS = 'flex w-[calc((100%-0px)/1)] shrink-0 flex-col gap-3 sm:w-[calc((100%-12px)/2)] lg:w-[calc((100%-24px)/3)] xl:w-[calc((100%-36px)/4)]'

/** Collection name key that triggers carousel display (plugins: partners, templates: featured) */
export const CAROUSEL_COLLECTION_NAMES = {
  partners: 'partners',
  featured: 'featured',
} as const

export type BaseCollection = {
  name: string
  label: Record<string, string>
  description: Record<string, string>
  searchable?: boolean
  search_params?: { query?: string, sort_by?: string, sort_order?: string }
}

type ViewMoreButtonProps = {
  searchParams?: SearchParamsFromCollection
  searchTab?: SearchTab
}

function ViewMoreButton({ searchParams, searchTab }: ViewMoreButtonProps) {
  const { t } = useTranslation()
  const onMoreClick = useMarketplaceMoreClick()

  return (
    <div
      className="system-xs-medium flex cursor-pointer items-center text-text-accent"
      onClick={() => onMoreClick(searchParams, searchTab)}
    >
      {t('marketplace.viewMore', { ns: 'plugin' })}
      <RiArrowRightSLine className="h-4 w-4" />
    </div>
  )
}

export { ViewMoreButton }

type CollectionHeaderProps<TCollection extends BaseCollection> = {
  collection: TCollection
  itemsLength: number
  locale: Locale
  carouselCollectionNames: string[]
  viewMore: React.ReactNode
}

function CollectionHeader<TCollection extends BaseCollection>({
  collection,
  itemsLength,
  locale,
  carouselCollectionNames,
  viewMore,
}: CollectionHeaderProps<TCollection>) {
  const showViewMore = collection.searchable
    && (carouselCollectionNames.includes(collection.name) || itemsLength > GRID_DISPLAY_LIMIT)

  return (
    <div className="mb-2 flex items-end justify-between">
      <div>
        <div className="title-xl-semi-bold text-text-primary">
          {collection.label[getLanguage(locale)]}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {collection.description[getLanguage(locale)]}
        </div>
      </div>
      {showViewMore && viewMore}
    </div>
  )
}

export { CarouselCollection, CollectionHeader }

type CarouselCollectionProps<TItem> = {
  items: TItem[]
  getItemKey: (item: TItem) => string
  renderCard: (item: TItem) => React.ReactNode
  cardContainerClassName?: string
}

function CarouselCollection<TItem>({
  items,
  getItemKey,
  renderCard,
  cardContainerClassName,
}: CarouselCollectionProps<TItem>) {
  const rows: TItem[][] = []
  for (let i = 0; i < items.length; i += 2)
    rows.push(items.slice(i, i + 2))

  return (
    <Carousel
      className={cardContainerClassName}
      showNavigation={items.length > 8}
      showPagination={items.length > 8}
      autoPlay={items.length > 8}
      autoPlayInterval={5000}
    >
      {rows.map((columnItems, idx) => (
        <div
          key={columnItems[0] ? getItemKey(columnItems[0]) : idx}
          className={CAROUSEL_COLUMN_CLASS}
          style={{ scrollSnapAlign: 'start' }}
        >
          {columnItems.map(item => (
            <div key={getItemKey(item)}>{renderCard(item)}</div>
          ))}
        </div>
      ))}
    </Carousel>
  )
}

type CollectionListProps<TItem, TCollection extends BaseCollection> = {
  collections: TCollection[]
  collectionItemsMap: Record<string, TItem[]>
  /** Field name to use as item key (e.g. 'plugin_id', 'template_id'). */
  itemKeyField: keyof TItem
  renderCard: (item: TItem) => React.ReactNode
  /** Collection names that use carousel layout (e.g. ['partners'], ['featured']). */
  carouselCollectionNames: string[]
  /** Search tab for ViewMoreButton (e.g. 'templates' for template collections). */
  viewMoreSearchTab?: SearchTab
  gridClassName?: string
  cardContainerClassName?: string
  emptyClassName?: string
}

function CollectionList<TItem, TCollection extends BaseCollection>({
  collections,
  collectionItemsMap,
  itemKeyField,
  renderCard,
  carouselCollectionNames,
  viewMoreSearchTab,
  gridClassName = GRID_CLASS,
  cardContainerClassName,
  emptyClassName,
}: CollectionListProps<TItem, TCollection>) {
  const locale = useLocale()

  const collectionsWithItems = collections.filter((collection) => {
    return collectionItemsMap[collection.name]?.length
  })

  if (collectionsWithItems.length === 0) {
    return <Empty className={emptyClassName} />
  }

  return (
    <>
      {
        collectionsWithItems.map((collection) => {
          const items = collectionItemsMap[collection.name]
          const isCarouselCollection = carouselCollectionNames.includes(collection.name)

          return (
            <div
              key={collection.name}
              className="py-3"
            >
              <CollectionHeader
                collection={collection}
                itemsLength={items.length}
                locale={locale}
                carouselCollectionNames={carouselCollectionNames}
                viewMore={<ViewMoreButton searchParams={collection.search_params} searchTab={viewMoreSearchTab} />}
              />
              {isCarouselCollection
                ? (
                  <CarouselCollection
                    items={items}
                    getItemKey={(item) => getItemKeyByField(item, itemKeyField)}
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
