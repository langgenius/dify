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
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  emptyClassName?: string
}
const List = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  plugins,
  showInstallButton,
  cardContainerClassName,
  cardRender,
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
            cardContainerClassName={cardContainerClassName}
            cardRender={cardRender}
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
                  />
                )
              })
            }
          </div>
        )
      }
      {
        plugins && !plugins.length && (
          <Empty className={emptyClassName} />
        )
      }
    </>
  )
}

export default List
