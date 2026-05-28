'use client'

import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import Category from '@/app/components/explore/category'

export function ExploreAppListHeader({
  allCategoriesEn,
  categories,
  currCategory,
  hasFilterCondition,
  keywords,
  resultCount,
  onCategoryChange,
  onKeywordsChange,
}: {
  allCategoriesEn: string
  categories: string[]
  currCategory: string
  hasFilterCondition: boolean
  keywords: string
  resultCount: number
  onCategoryChange: (category: string) => void
  onKeywordsChange: (keywords: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="sticky top-0 z-10 bg-background-body">
      <div className="px-12 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center">
            <div className="grow truncate system-xl-medium text-text-primary">
              {!hasFilterCondition
                ? t('apps.title', { ns: 'explore' })
                : t('apps.resultNum', {
                    num: resultCount,
                    ns: 'explore',
                  })}
            </div>
          </div>
          <p className="truncate system-xs-regular text-text-tertiary">
            {t('apps.description', { ns: 'explore' })}
          </p>
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 px-12 pt-3 pb-3">
        <Category
          className="min-w-0"
          list={categories}
          value={currCategory}
          onChange={onCategoryChange}
          allCategoriesEn={allCategoriesEn}
        />
        <div className="flex shrink-0 items-center gap-3">
          <SearchInput
            className="w-[200px] shrink-0"
            value={keywords}
            onChange={onKeywordsChange}
          />
        </div>
      </div>
    </div>
  )
}
