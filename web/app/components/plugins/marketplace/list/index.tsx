'use client'
import type { Plugin, PluginDetail } from '../../types'
import type { MarketplaceCollection } from '../types'
import ListWithCollection from './list-with-collection'
import CardWrapper from './card-wrapper'
import Empty from '../empty'
import cn from '@/utils/classnames'

type ListProps = {
  marketplaceCollections: MarketplaceCollection[]
  marketplaceCollectionPluginsMap: Record<string, Plugin[]>
  plugins?: Plugin[]
  showInstallButton?: boolean
  installedPluginList?: PluginDetail[]
  locale: string
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => JSX.Element | null
  onMoreClick?: () => void
  emptyClassName?: string
}
const List = ({
  marketplaceCollections,
  marketplaceCollectionPluginsMap,
  plugins,
  showInstallButton,
  installedPluginList,
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
          )}>
            {
              plugins.map((plugin) => {
                if (cardRender)
                  return cardRender(plugin)

                const isInstalled = installedPluginList?.some(
                  installedPlugin => installedPlugin.name === plugin.name,
                )

                return (
                  <CardWrapper
                    key={plugin.name}
                    plugin={plugin}
                    showInstallButton={showInstallButton}
                    locale={locale}
                    installed={isInstalled}
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
