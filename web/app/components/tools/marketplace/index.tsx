import {
  useEffect,
  useRef,
} from 'react'
import {
  RiArrowRightUpLine,
  RiArrowUpDoubleLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useMarketplace } from './hooks'
import List from '@/app/components/plugins/marketplace/list'
import Loading from '@/app/components/base/loading'
import { getLocaleOnClient } from '@/i18n'
import { MARKETPLACE_URL_PREFIX } from '@/config'

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
  const locale = getLocaleOnClient()
  const { t } = useTranslation()

  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
    handleScroll,
    page,
  } = useMarketplace(searchPluginText, filterPluginTags)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container)
      container.addEventListener('scroll', handleScroll)

    return () => {
      if (container)
        container.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  return (
    <div
      ref={containerRef}
      className='grow flex flex-col shrink-0 sticky bottom-[-442px] h-[530px] overflow-y-auto px-12 py-2 pt-0 bg-background-default-subtle'
    >
      <RiArrowUpDoubleLine
        className='absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 text-text-quaternary cursor-pointer'
        onClick={() => onMarketplaceScroll()}
      />
      <div className='sticky top-0 pt-5 pb-3 bg-background-default-subtle z-10'>
        <div className='title-2xl-semi-bold bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent'>
          {t('plugin.marketplace.moreFrom')}
        </div>
        <div className='flex items-center text-center body-md-regular text-text-tertiary'>
          {t('plugin.marketplace.discover')}
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            {t('plugin.category.models')}
          </span>
          ,
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            {t('plugin.category.tools')}
          </span>
          ,
          <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            {t('plugin.category.agents')}
          </span>
          ,
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            {t('plugin.category.extensions')}
          </span>
          {t('plugin.marketplace.and')}
          <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
            {t('plugin.category.bundles')}
          </span>
          {t('common.operation.in')}
          <a
            href={`${MARKETPLACE_URL_PREFIX}?language=${locale}&q=${searchPluginText}&tags=${filterPluginTags.join(',')}`}
            className='flex items-center ml-1 system-sm-medium text-text-accent'
            target='_blank'
          >
            {t('plugin.marketplace.difyMarketplace')}
            <RiArrowRightUpLine className='w-4 h-4' />
          </a>
        </div>
      </div>
      {
        isLoading && page === 1 && (
          <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
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
            showInstallButton
            locale={locale}
          />
        )
      }
    </div>
  )
}

export default Marketplace
