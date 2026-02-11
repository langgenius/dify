'use client'

import type { FilterOption } from './filter-chip'
import { useTranslation } from '#i18n'
import { useMemo } from 'react'
import { useTags } from '@/app/components/plugins/hooks'
import { useSearchFilterTags, useSearchFilterType } from '../atoms'
import { usePluginCategoryText } from '../category-switch/category-text'
import { CATEGORY_ALL, PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import FilterChip from './filter-chip'

const PluginFilters = () => {
  const { t } = useTranslation()
  const [searchType, setSearchType] = useSearchFilterType()
  const [searchTags, setSearchTags] = useSearchFilterTags()
  const getPluginCategoryText = usePluginCategoryText()
  const { tags: tagsList } = useTags()

  const typeOptions: FilterOption[] = useMemo(() => {
    return Object.values(PLUGIN_TYPE_SEARCH_MAP).map(value => ({
      value,
      label: getPluginCategoryText(value),
    }))
  }, [getPluginCategoryText])

  const tagOptions: FilterOption[] = useMemo(() => {
    return tagsList.map(tag => ({
      value: tag.name,
      label: tag.label,
    }))
  }, [tagsList])

  const typeValue = searchType === CATEGORY_ALL ? [] : [searchType]

  return (
    <div className="flex items-center gap-2">
      <FilterChip
        label={t('marketplace.searchFilterTypes', { ns: 'plugin' })}
        options={typeOptions}
        value={typeValue}
        onChange={(v) => {
          const newType = v.length > 0 ? v[v.length - 1] : CATEGORY_ALL
          setSearchType(newType === CATEGORY_ALL ? null : newType)
        }}
        multiple={false}
      />
      <FilterChip
        label={t('marketplace.searchFilterTags', { ns: 'plugin' })}
        options={tagOptions}
        value={searchTags}
        onChange={v => setSearchTags(v.length ? v : null)}
        multiple
        searchable
        searchPlaceholder={t('searchTags', { ns: 'pluginTags' }) || ''}
      />
    </div>
  )
}

export default PluginFilters
