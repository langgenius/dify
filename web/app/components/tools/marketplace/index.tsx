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
      className='bg-background-default-subtle sticky bottom-[-442px] flex h-[530px] shrink-0 grow flex-col overflow-y-auto px-12 py-2 pt-0'
    >
      <RiArrowUpDoubleLine
        className='text-text-quaternary absolute left-1/2 top-2 h-4 w-4 -translate-x-1/2 cursor-pointer'
        onClick={() => onMarketplaceScroll()}
      />
      <div className='bg-background-default-subtle sticky top-0 z-10 pb-3 pt-5'>
        <div className='title-2xl-semi-bold bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent'>
          {t('plugin.marketplace.moreFrom')}
        </div>
        <div className='body-md-regular text-text-tertiary flex items-center text-center'>
          {t('plugin.marketplace.discover')}
          <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
            {t('plugin.category.models')}
          </span>
          ,
          <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
            {t('plugin.category.tools')}
          </span>
          ,
          <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
            {t('plugin.category.agents')}
          </span>
          ,
          <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative ml-1 mr-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
            {t('plugin.category.extensions')}
          </span>
          {t('plugin.marketplace.and')}
          <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative ml-1 mr-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
            {t('plugin.category.bundles')}
          </span>
          {t('common.operation.in')}
          <a
            href={`${MARKETPLACE_URL_PREFIX}?language=${locale}&q=${searchPluginText}&tags=${filterPluginTags.join(',')}`}
            className='system-sm-medium text-text-accent ml-1 flex items-center'
            target='_blank'
          >
            {t('plugin.marketplace.difyMarketplace')}
            <RiArrowRightUpLine className='h-4 w-4' />
          </a>
        </div>
      </div>
      {
        isLoading && page === 1 && (
          <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
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
