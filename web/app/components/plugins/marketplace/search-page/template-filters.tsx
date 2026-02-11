'use client'

import type { FilterOption } from './filter-chip'
import { useTranslation } from '#i18n'
import { useMemo } from 'react'
import { useSearchFilterCategories, useSearchFilterLanguages } from '../atoms'
import { useTemplateCategoryText } from '../category-switch/category-text'
import { TEMPLATE_CATEGORY_MAP } from '../constants'
import { LANGUAGE_OPTIONS } from './constants'
import FilterChip from './filter-chip'

const TemplateFilters = () => {
  const { t } = useTranslation()
  const [categories, setCategories] = useSearchFilterCategories()
  const [languages, setLanguages] = useSearchFilterLanguages()
  const getTemplateCategoryText = useTemplateCategoryText()

  const categoryOptions: FilterOption[] = useMemo(() => {
    const entries = Object.entries(TEMPLATE_CATEGORY_MAP).filter(([key]) => key !== 'all')
    return entries.map(([, value]) => ({
      value,
      label: getTemplateCategoryText(value),
    }))
  }, [getTemplateCategoryText])

  const languageOptions: FilterOption[] = useMemo(() => {
    return LANGUAGE_OPTIONS.map(lang => ({
      value: lang.value,
      label: `${lang.nativeLabel}`,
    }))
  }, [])

  return (
    <div className="flex items-center gap-2">
      <FilterChip
        label={t('marketplace.searchFilterCategory', { ns: 'plugin' })}
        options={categoryOptions}
        value={categories}
        onChange={v => setCategories(v.length ? v : null)}
        multiple
        searchable
        searchPlaceholder={t('searchCategories', { ns: 'plugin' })}
      />
      <FilterChip
        label={t('marketplace.searchFilterLanguage', { ns: 'plugin' })}
        options={languageOptions}
        value={languages}
        onChange={v => setLanguages(v.length ? v : null)}
        multiple
      />
    </div>
  )
}

export default TemplateFilters
