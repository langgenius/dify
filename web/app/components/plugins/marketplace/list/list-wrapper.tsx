'use client'
import { useTranslation } from '#i18n'
import Loading from '@/app/components/base/loading'
import SortDropdown from '../sort-dropdown'
import { useMarketplaceData } from '../state'
import List from './index'

type ListWrapperProps = {
  showInstallButton?: boolean
}
const ListWrapper = ({
  showInstallButton,
}: ListWrapperProps) => {
  const { t } = useTranslation()

  const {
    plugins,
    pluginsTotal,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    isLoading,
    isFetchingNextPage,
    page,
  } = useMarketplaceData()

  return (
    <div
      style={{ scrollbarGutter: 'stable' }}
      className="relative flex grow flex-col bg-background-default-subtle px-12 py-2"
    >
      {
        plugins && (
          <div className="mb-4 flex items-center pt-3">
            <div className="title-xl-semi-bold text-text-primary">{t('marketplace.pluginsResult', { ns: 'plugin', num: pluginsTotal })}</div>
            <div className="mx-3 h-3.5 w-[1px] bg-divider-regular"></div>
            <SortDropdown />
          </div>
        )
      }
      {
        isLoading && page === 1 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Loading />
          </div>
        )
      }
      {
        (!isLoading || page > 1) && (
          <List
            marketplaceCollections={marketplaceCollections || []}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap || {}}
            plugins={plugins}
            showInstallButton={showInstallButton}
          />
        )
      }
      {
        isFetchingNextPage && (
          <Loading className="my-3" />
        )
      }
    </div>
  )
}

export default ListWrapper
