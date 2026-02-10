'use client'

import type { SearchTab } from '../search-params'
import type { SearchParamsFromCollection } from '../types'
import type { BaseCollection } from './collection-constants'
import type { Locale } from '@/i18n-config/language'
import { useLocale, useTranslation } from '#i18n'
import { RiArrowRightSLine } from '@remixicon/react'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'
import { useMarketplaceMoreClick } from '../atoms'
import Empty from '../empty'
import { getItemKeyByField } from '../utils'
import Carousel from './carousel'
import { CAROUSEL_COLUMN_CLASS, CAROUSEL_MAX_VISIBLE_COLUMNS, GRID_CLASS, GRID_DISPLAY_LIMIT } from './collection-constants'

type ViewMoreButtonProps = {
  searchParams?: SearchParamsFromCollection
  searchTab?: SearchTab
}

export function ViewMoreButton({ searchParams, searchTab }: ViewMoreButtonProps) {
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

type CollectionHeaderProps<TCollection extends BaseCollection> = {
  collection: TCollection
  itemsLength: number
  locale: Locale
  carouselCollectionNames: string[]
  viewMore: React.ReactNode
}

export function CollectionHeader<TCollection extends BaseCollection>({
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
  const useDoubleRow = items.length > CAROUSEL_MAX_VISIBLE_COLUMNS
  const numColumns = useDoubleRow ? Math.ceil(items.length / 2) : items.length
  const columns: TItem[][] = []
  for (let i = 0; i < numColumns; i++) {
    const column: TItem[] = [items[i]]
    if (useDoubleRow && i + numColumns < items.length)
      column.push(items[i + numColumns])
    columns.push(column)
  }

  return (
    <Carousel
      className={cardContainerClassName}
      showNavigation={items.length > 8}
      showPagination={items.length > 8}
      autoPlay={items.length > 8}
      autoPlayInterval={5000}
    >
      {columns.map((columnItems, idx) => (
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
  /** Field name to use as item key (e.g. 'plugin_id', 'id'). */
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
