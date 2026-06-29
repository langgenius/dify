'use client'

import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import Category from '@/app/components/explore/category'

export function ExploreAppListHeader({
  allCategoriesEn,
  categories,
  currCategory,
  keywords,
  onCategoryChange,
  onKeywordsChange,
}: {
  allCategoriesEn: string
  categories: string[]
  currCategory: string
  keywords: string
  onCategoryChange: (category: string) => void
  onKeywordsChange: (keywords: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="sticky top-0 z-10 bg-background-body">
      <div className="flex items-center gap-2 px-8 pt-6">
        <div className="min-w-0 flex-1 truncate system-xl-medium text-text-primary">
          {t('apps.title', { ns: 'explore' })}
        </div>
        <a
          href="https://marketplace.dify.ai/templates"
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary hover:text-text-secondary"
        >
          {t('apps.viewMore', { ns: 'explore' })}
          <span className="i-ri-arrow-right-line size-3 shrink-0" aria-hidden="true" />
        </a>
      </div>

      <div className="flex items-start justify-between gap-2 px-8 pt-3 pb-3">
        <Category
          className="min-w-0"
          list={categories}
          value={currCategory}
          onChange={onCategoryChange}
          allCategoriesEn={allCategoriesEn}
        />
        <div className="flex shrink-0 items-center gap-3">
          <SearchInput
            className="w-40 shrink-0"
            value={keywords}
            onValueChange={onKeywordsChange}
          />
        </div>
      </div>
    </div>
  )
}
