'use client'

import type { Plugin } from '../../types'
import type { PluginCollection } from '../types'
import { cn } from '@/utils/classnames'
import Empty from '../empty'
import CardWrapper from './card-wrapper'
import { GRID_CLASS } from './collection-constants'
import ListWithCollection from './list-with-collection'

type ListProps = {
  pluginCollections: PluginCollection[]
  pluginCollectionPluginsMap: Record<string, Plugin[]>
  plugins?: Plugin[]
  showInstallButton?: boolean
  cardContainerClassName?: string
  cardRender?: (plugin: Plugin) => React.JSX.Element | null
  emptyClassName?: string
}
const List = ({
  pluginCollections,
  pluginCollectionPluginsMap,
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
            variant="plugins"
            collections={pluginCollections}
            collectionItemsMap={pluginCollectionPluginsMap}
            showInstallButton={showInstallButton}
            cardContainerClassName={cardContainerClassName}
            cardRender={cardRender}
          />
        )
      }
      {
        plugins && !!plugins.length && (
          <div className={cn(GRID_CLASS, cardContainerClassName)}>
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
