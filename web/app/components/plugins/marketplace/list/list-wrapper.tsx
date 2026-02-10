'use client'

import Loading from '@/app/components/base/loading'
import { useMarketplaceData } from '../state'
import FlatList from './flat-list'
import ListWithCollection from './list-with-collection'

type ListWrapperProps = {
  showInstallButton?: boolean
}

const ListWrapper = ({ showInstallButton }: ListWrapperProps) => {
  const marketplaceData = useMarketplaceData()
  const { creationType, isLoading, page, isFetchingNextPage } = marketplaceData

  const isPluginView = creationType === 'plugins'

  const renderContent = () => {
    if (!isPluginView) {
      const { templateCollections, templateCollectionTemplatesMap, templates } = marketplaceData
      if (templates !== undefined) {
        return (
          <FlatList
            variant="templates"
            items={templates}
          />
        )
      }

      return (
        <ListWithCollection
          variant="templates"
          collections={templateCollections || []}
          collectionItemsMap={templateCollectionTemplatesMap || {}}
        />
      )
    }

    const { pluginCollections, pluginCollectionPluginsMap, plugins } = marketplaceData
    if (plugins !== undefined) {
      return (
        <FlatList
          variant="plugins"
          items={plugins}
          showInstallButton={showInstallButton}
        />
      )
    }

    return (
      <ListWithCollection
        variant="plugins"
        collections={pluginCollections || []}
        collectionItemsMap={pluginCollectionPluginsMap || {}}
        showInstallButton={showInstallButton}
      />
    )
  }

  return (
    <div
      style={{ scrollbarGutter: 'stable' }}
      className="relative flex grow flex-col bg-background-default-subtle px-12 py-2"
    >
      {isLoading && page === 1 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading />
        </div>
      )}
      {(!isLoading || page > 1) && renderContent()}
      {isFetchingNextPage && <Loading className="my-3" />}
    </div>
  )
}

export default ListWrapper
