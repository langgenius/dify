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
      style={{
        scrollbarGutter: 'stable',
        paddingBottom: 'calc(0.5rem + var(--marketplace-header-collapse-offset, 0px))',
      }}
      className="relative flex grow flex-col bg-background-default-subtle px-8 py-2"
    >
      <div className="flex w-full grow flex-col">
        {
          plugins && (
            <div className="mb-4 flex items-center pt-3">
              <div className="title-xl-semi-bold text-text-primary">{t($ => $['marketplace.pluginsResult'], { ns: 'plugin', num: pluginsTotal })}</div>
              <div className="mx-3 h-3.5 w-px bg-divider-regular"></div>
              <SortDropdown />
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
      </div>
      {
        isLoading && page === 1 && (
          <div className="absolute top-1/2 left-1/2 -translate-1/2">
            <Loading />
          </div>
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
