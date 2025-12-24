'use client'
import type { Plugin } from '../../types'
import type { MarketplaceCollection } from '../types'
import { cn } from '@/utils/classnames'
import Empty from '../empty'
import CardWrapper from './card-wrapper'
import ListWithCollection from './list-with-collection'

type ListProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  plugins?: Plugin[]
  showInstallButton?: boolean
  locale: string
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  onMoreClick?: () => void
  emptyClassName?: string
}
const List = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  plugins,
  showInstallButton,
  locale,
  cardContainerClassName,
  cardRender,
  onMoreClick,
  emptyClassName,
}: ListProps) => {
  return (
    <>
      {
        !plugins && (
          <ListWithCollection
            marketplaceCollections={marketplaceCollections}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
            showInstallButton={showInstallButton}
            locale={locale}
            cardContainerClassName={cardContainerClassName}
            cardRender={cardRender}
            onMoreClick={onMoreClick}
          />
        )
      }
      {
        plugins && !!plugins.length && (
          <div className={cn(
            'grid grid-cols-4 gap-3',
            cardContainerClassName,
          )}
          >
            {
              plugins.map((plugin) => {
                if (cardRender)
                  return cardRender(plugin)

                return (
                  <CardWrapper
                    key={`${plugin.org}/${plugin.name}`}
                    plugin={plugin}
                    showInstallButton={showInstallButton}
                    locale={locale}
                  />
                )
              })
            }
          </div>
        )
      }
      {
        plugins && !plugins.length && (
          <Empty className={emptyClassName} locale={locale} />
        )
      }
    </>
  )
}

export default List
