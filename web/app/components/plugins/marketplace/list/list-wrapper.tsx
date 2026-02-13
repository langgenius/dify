'use client'

import Loading from '@/app/components/base/loading'
import { useMarketplaceSearchMode } from '../atoms'
import { isPluginsData, useMarketplaceData } from '../state'
import FlatList from './flat-list'
import ListTopInfo from './list-top-info'
import ListWithCollection from './list-with-collection'

type ListWrapperProps = {
  showInstallButton?: boolean
}

const ListWrapper = ({ showInstallButton }: ListWrapperProps) => {
  const marketplaceData = useMarketplaceData()
  const { isLoading, page, isFetchingNextPage } = marketplaceData
  const isSearchMode = useMarketplaceSearchMode()

  const renderContent = () => {
    if (isPluginsData(marketplaceData)) {
      const { pluginCollections, pluginCollectionPluginsMap, plugins } = marketplaceData
      return plugins !== undefined
        ? (
            <FlatList variant="plugins" items={plugins} showInstallButton={showInstallButton} />
          )
        : (
            <ListWithCollection
              variant="plugins"
              collections={pluginCollections || []}
              collectionItemsMap={pluginCollectionPluginsMap || {}}
              showInstallButton={showInstallButton}
            />
          )
    }

    const { templateCollections, templateCollectionTemplatesMap, templates } = marketplaceData
    return templates !== undefined
      ? (
          <FlatList variant="templates" items={templates} />
        )
      : (
          <ListWithCollection
            variant="templates"
            collections={templateCollections || []}
            collectionItemsMap={templateCollectionTemplatesMap || {}}
          />
        )
  }

  return (
    <div
      style={{
        scrollbarGutter: 'stable',
        paddingBottom: 'calc(0.5rem + var(--marketplace-header-collapse-offset, 0px))',
      }}
      className="relative flex grow flex-col bg-background-default-subtle px-12 pt-2"
    >
      {isSearchMode && <ListTopInfo />}
      <div className="relative flex grow flex-col">
        {isLoading && page === 1 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Loading />
          </div>
        )}
        {(!isLoading || page > 1) && renderContent()}
      </div>
      {isFetchingNextPage && <Loading className="my-3" />}
    </div>
  )
}

export default ListWrapper
