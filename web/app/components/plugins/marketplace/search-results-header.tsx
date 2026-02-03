'use client'

import { useTranslation } from '#i18n'
import { useSearchPluginText } from './atoms'

const SearchResultsHeader = () => {
  const { t } = useTranslation('plugin')
  const [searchPluginText] = useSearchPluginText()

  return (
    <div className="px-12 py-4">
      <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
        <span>{t('marketplace.searchBreadcrumbMarketplace')}</span>
        <span className="text-text-quaternary">/</span>
        <span>{t('marketplace.searchBreadcrumbSearch')}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="title-4xl-semi-bold text-text-primary">
          {t('marketplace.searchResultsFor')}
        </div>
        <div className="relative title-4xl-semi-bold text-saas-dify-blue-accessible">
          <span className="relative z-10">{searchPluginText || ''}</span>
          <span className="absolute bottom-0 left-0 right-0 h-3 bg-saas-dify-blue-accessible opacity-10" />
        </div>
      </div>
    </div>
  )
}

export default SearchResultsHeader
