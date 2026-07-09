import type { SearchParamsFromCollection } from '@dify/contracts/marketplace'
import type { ToolsContentInset } from '../content-inset'
import type { useMarketplace } from './hooks'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArrowRightUpLine,
  RiArrowUpDoubleLine,
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { useRouter } from '@/next/navigation'
import { getMarketplaceUrl } from '@/utils/var'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '../content-inset'

type MarketplaceProps = {
  searchPluginText: string
  filterPluginTags: string[]
  isMarketplaceArrowVisible: boolean
  showMarketplacePanel: () => void
  marketplaceContext: ReturnType<typeof useMarketplace>
  contentInset?: ToolsContentInset
}
const Marketplace = ({
  searchPluginText,
  filterPluginTags,
  isMarketplaceArrowVisible,
  showMarketplacePanel,
  marketplaceContext,
  contentInset = 'default',
}: MarketplaceProps) => {
  const locale = useLocale()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const router = useRouter()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const {
    isLoading,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    plugins,
    page,
  } = marketplaceContext
  const contentPaddingClassName = toolsContentInsetClassNames[contentInset]
  const marketplaceFrameClassName = cn(contentPaddingClassName, toolsUnifiedContentFrameClassName)
  const cardContainerClassName = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3'
  const handleCollectionMoreClick = (searchParams?: SearchParamsFromCollection) => {
    const params = new URLSearchParams({ category: 'tool' })

    if (searchParams?.query)
      params.set('q', searchParams.query)
    if (searchParams?.sort_by)
      params.set('sort_by', searchParams.sort_by)
    if (searchParams?.sort_order)
      params.set('sort_order', searchParams.sort_order)

    router.push(`/marketplace?${params.toString()}`)
  }

  return (
    <>
      <div className="sticky bottom-0 flex shrink-0 flex-col bg-background-default-subtle pt-2 pb-[14px]">
        {isMarketplaceArrowVisible && (
          <RiArrowUpDoubleLine
            className="absolute top-2 left-1/2 z-10 size-4 -translate-x-1/2 cursor-pointer text-text-quaternary"
            onClick={showMarketplacePanel}
          />
        )}
        <div className={cn('pt-4 pb-3', marketplaceFrameClassName)}>
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
              <RiArrowRightUpLine className="size-4" />
            </a>
          </div>
        </div>
      </div>
      <div className="mt-[-14px] shrink-0 grow bg-background-default-subtle pb-2">
        {
          isLoading && page === 1 && (
            <div className="absolute top-1/2 left-1/2 -translate-1/2">
              <Loading />
            </div>
          )
        }
        {
          (!isLoading || page > 1) && (
            <div className={marketplaceFrameClassName}>
              <List
                marketplaceCollections={marketplaceCollections || []}
                marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap || {}}
                plugins={plugins}
                showInstallButton={canInstallPlugin}
                cardContainerClassName={cardContainerClassName}
                onCollectionMoreClick={handleCollectionMoreClick}
              />
            </div>
          )
        }
      </div>
    </>
  )
}

export default Marketplace
