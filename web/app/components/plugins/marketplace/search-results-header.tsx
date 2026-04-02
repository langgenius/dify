'use client'

import { useTranslation } from '#i18n'
import { useSearchText } from './atoms'

type SearchResultsHeaderProps = {
  marketplaceNav?: React.ReactNode
}
const SearchResultsHeader = ({ marketplaceNav }: SearchResultsHeaderProps) => {
  const { t } = useTranslation('plugin')
  const [searchText] = useSearchText()

  return (
    <div className="relative px-7 py-4">
      {marketplaceNav}
      <div className="system-xs-regular mt-8 flex items-center gap-1 px-5 text-text-tertiary ">
        <span>{t('marketplace.searchBreadcrumbMarketplace')}</span>
        <span className="text-text-quaternary">/</span>
        <span>{t('marketplace.searchBreadcrumbSearch')}</span>
      </div>
      <div className="mt-2 flex items-end gap-2 px-5 ">
        <div className="title-4xl-semi-bold text-text-primary">
          {t('marketplace.searchResultsFor')}
        </div>
        <div className="title-4xl-semi-bold relative text-saas-dify-blue-accessible">
          <span className="relative z-10">{searchText || ''}</span>
          <span className="absolute bottom-0 left-0 right-0 h-3 bg-saas-dify-blue-accessible opacity-10" />
        </div>
      </div>
    </div>
  )
}

export default SearchResultsHeader
