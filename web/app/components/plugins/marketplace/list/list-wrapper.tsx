'use client'
import type { ActivePluginType } from '../constants'
import { useTranslation } from '#i18n'
import { useState } from 'react'
import Loading from '@/app/components/base/loading'
import SegmentedControl from '@/app/components/base/segmented-control'
import CategoriesFilter from '../../plugin-page/filter-management/category-filter'
import TagFilter from '../../plugin-page/filter-management/tag-filter'
import { useActivePluginType, useFilterPluginTags, useMarketplaceSearchMode } from '../atoms'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import SortDropdown from '../sort-dropdown'
import { useMarketplaceData } from '../state'
import List from './index'
import TemplateList from './template-list'

type ListWrapperProps = {
  showInstallButton?: boolean
}
type SearchScope = 'all' | 'plugins' | 'creators'
const searchScopeOptionKeys = [
  { value: 'all', textKey: 'marketplace.searchFilterAll' },
  { value: 'plugins', textKey: 'marketplace.searchFilterPlugins' },
  { value: 'creators', textKey: 'marketplace.searchFilterCreators' },
] as const satisfies ReadonlyArray<{ value: SearchScope, textKey: 'marketplace.searchFilterAll' | 'marketplace.searchFilterPlugins' | 'marketplace.searchFilterCreators' }>

const ListWrapper = ({
  showInstallButton,
}: ListWrapperProps) => {
  const { t } = useTranslation()
  const isSearchMode = useMarketplaceSearchMode()
  const [filterPluginTags, handleFilterPluginTagsChange] = useFilterPluginTags()
  const [activePluginType, handleActivePluginTypeChange] = useActivePluginType()
  const [searchScope, setSearchScope] = useState<SearchScope>('all')

  const marketplaceData = useMarketplaceData()
  const {
    creationType,
    isLoading,
  } = marketplaceData

  // Templates view
  if (creationType === 'templates') {
    const { templateCollections, templateCollectionTemplatesMap } = marketplaceData
    return (
      <div
        style={{ scrollbarGutter: 'stable' }}
        className="relative flex grow flex-col bg-background-default-subtle px-12 py-2"
      >
        {
          isLoading && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <Loading />
            </div>
          )
        }
        {
          !isLoading && (
            <TemplateList
              templateCollections={templateCollections || []}
              templateCollectionTemplatesMap={templateCollectionTemplatesMap || {}}
            />
          )
        }
      </div>
    )
  }

  // Plugins view (default)
  const {
    plugins,
    pluginsTotal,
    marketplaceCollections,
    marketplaceCollectionPluginsMap,
    isFetchingNextPage,
    page,
  } = marketplaceData

  const pluginsCount = pluginsTotal || 0
  const searchScopeOptions: Array<{ value: SearchScope, text: string, count: number }> = searchScopeOptionKeys.map(option => ({
    value: option.value,
    text: t(option.textKey, { ns: 'plugin' }),
    count: option.value === 'creators' ? 0 : pluginsCount,
  }))

  return (
    <div
      style={{ scrollbarGutter: 'stable' }}
      className="relative flex grow flex-col bg-background-default-subtle px-12 py-2"
    >
      {plugins && !isSearchMode && (
        <div className="mb-4 flex items-center pt-3">
          <div className="title-xl-semi-bold text-text-primary">{t('marketplace.pluginsResult', { ns: 'plugin', num: pluginsTotal })}</div>
          <div className="mx-3 h-3.5 w-[1px] bg-divider-regular"></div>
          <SortDropdown />
        </div>
      )}
      {isSearchMode && (
        <div className="mb-4 flex items-center justify-between pt-3">
          <div className="flex items-center gap-2">
            <SegmentedControl
              size="large"
              activeState="accentLight"
              value={searchScope}
              onChange={(value) => {
                setSearchScope(value as SearchScope)
              }}
              options={searchScopeOptions}
            />
            <CategoriesFilter
              value={activePluginType === PLUGIN_TYPE_SEARCH_MAP.all ? [] : [activePluginType]}
              onChange={(categories) => {
                if (categories.length === 0) {
                  handleActivePluginTypeChange(PLUGIN_TYPE_SEARCH_MAP.all)
                  return
                }
                handleActivePluginTypeChange(categories[categories.length - 1] as ActivePluginType)
              }}
            />
            <TagFilter
              value={filterPluginTags}
              onChange={handleFilterPluginTagsChange}
            />
          </div>
          <SortDropdown />
        </div>
      )}
      {
        isLoading && page === 1 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
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
            showInstallButton={showInstallButton}
          />
        )
      }
      {
        isFetchingNextPage && (
          <Loading className="my-3" />
        )
      }
    </div>
  )
}

export default ListWrapper
