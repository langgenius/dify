import { RiArrowUpDoubleLine } from '@remixicon/react'
import { useMarketplace } from './hooks'
import List from '@/app/components/plugins/marketplace/list'
import Loading from '@/app/components/base/loading'

type MarketplaceProps = {
  searchPluginText: string
  filterPluginTags: string[]
  onMarketplaceScroll: () => void
}
const Marketplace = ({
  searchPluginText,
  filterPluginTags,
  onMarketplaceScroll,
}: MarketplaceProps) => {
  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
  } = useMarketplace(searchPluginText, filterPluginTags)

  return (
    <div className='shrink-0 sticky -bottom-[442px] h-[530px] overflow-y-auto px-12 py-2 pt-0 bg-background-default-subtle'>
      <RiArrowUpDoubleLine
        className='absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 text-text-quaternary cursor-pointer'
        onClick={() => onMarketplaceScroll()}
      />
      <div className='sticky top-0 pt-5 pb-3 bg-background-default-subtle z-10'>
        <div className='title-2xl-semi-bold bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent'>More from Marketplace</div>
        <div className='flex items-center text-center body-md-regular text-text-tertiary'>
          Discover
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            models
          </span>
          ,
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            tools
          </span>
          ,
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            extensions
          </span>
          and
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            bundles
          </span>
          in Dify Marketplace
        </div>
      </div>
      {
        isLoading && (
          <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
            <Loading />
          </div>
        )
      }
      {
        !isLoading && (
          <List
            marketplaceCollections={marketplaceCollections}
            marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
            plugins={plugins}
            showInstallButton
          />
        )
      }
    </div>
  )
}

export default Marketplace
