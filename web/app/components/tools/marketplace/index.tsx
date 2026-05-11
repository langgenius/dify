import type { useMarketplace } from './hooks'
import { useLocale } from '#i18n'
import {
  RiArrowRightUpLine,
  RiArrowUpDoubleLine,
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import { getMarketplaceUrl } from '@/utils/var'

type MarketplaceProps = {
  searchPluginText: string
  filterPluginTags: string[]
  isMarketplaceArrowVisible: boolean
  showMarketplacePanel: () => void
  marketplaceContext: ReturnType<typeof useMarketplace>
}
const Marketplace = ({
  searchPluginText,
  filterPluginTags,
  isMarketplaceArrowVisible,
  showMarketplacePanel,
  marketplaceContext,
}: MarketplaceProps) => {
  const locale = useLocale()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
    page,
  } = marketplaceContext

  return (
    <>
      <div className="sticky bottom-0 flex shrink-0 flex-col bg-background-default-subtle px-12 pt-2 pb-[14px]">
        {isMarketplaceArrowVisible && (
          <RiArrowUpDoubleLine
            className="absolute top-2 left-1/2 z-10 h-4 w-4 -translate-x-1/2 cursor-pointer text-text-quaternary"
            onClick={showMarketplacePanel}
          />
        )}
        <div className="pt-4 pb-3">
          <div className="bg-linear-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text title-2xl-semi-bold text-transparent">
            {t('marketplace.moreFrom', { ns: 'plugin' })}
          </div>
          <div className="flex items-center text-center body-md-regular text-text-tertiary">
            {t('marketplace.discover', { ns: 'plugin' })}
            <span className="relative ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.models', { ns: 'plugin' })}
            </span>
            ,
            <span className="relative ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.tools', { ns: 'plugin' })}
            </span>
            ,
            <span className="relative ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.datasources', { ns: 'plugin' })}
            </span>
            ,
            <span className="relative ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.triggers', { ns: 'plugin' })}
            </span>
            ,
            <span className="relative ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.agents', { ns: 'plugin' })}
            </span>
            ,
            <span className="relative mr-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.extensions', { ns: 'plugin' })}
            </span>
            {t('marketplace.and', { ns: 'plugin' })}
            <span className="relative mr-1 ml-1 body-md-medium text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
              {t('category.bundles', { ns: 'plugin' })}
            </span>
            {t('operation.in', { ns: 'common' })}
            <a
              href={getMarketplaceUrl('', { language: locale, q: searchPluginText, tags: filterPluginTags.join(','), theme })}
              className="ml-1 flex items-center system-sm-medium text-text-accent"
              target="_blank"
            >
              {t('marketplace.difyMarketplace', { ns: 'plugin' })}
              <RiArrowRightUpLine className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
      <div className="mt-[-14px] shrink-0 grow bg-background-default-subtle px-12 pb-2">
        {
          isLoading && page === 1 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
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
            />
          )
        }
      </div>
    </>
  )
}

export default Marketplace
