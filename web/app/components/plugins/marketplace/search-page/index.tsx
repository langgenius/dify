'use client'

import type { SearchTab } from '../search-params'
import type { Creator, PluginsSearchParams, Template } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo } from 'react'
import Loading from '@/app/components/base/loading'
import SegmentedControl from '@/app/components/base/segmented-control'
import { useMarketplaceSortValue, useSearchTab, useSearchText } from '../atoms'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import Empty from '../empty'
import { useMarketplaceContainerScroll } from '../hooks'
import CardWrapper from '../list/card-wrapper'
import TemplateCard from '../list/template-card'
import { useMarketplaceCreators, useMarketplacePlugins, useMarketplaceTemplates } from '../query'
import SortDropdown from '../sort-dropdown'
import { getPluginFilterType, mapTemplateDetailToTemplate } from '../utils'
import CreatorCard from './creator-card'

const PAGE_SIZE = 40
const ALL_TAB_PREVIEW_SIZE = 8
const ZERO_WIDTH_SPACE = '\u200B'

type SortValue = { sortBy: string, sortOrder: string }

function mapSortForTemplates(sort: SortValue): { sort_by: string, sort_order: string } {
  const sortBy = sort.sortBy === 'install_count' ? 'usage_count' : sort.sortBy === 'version_updated_at' ? 'updated_at' : sort.sortBy
  return { sort_by: sortBy, sort_order: sort.sortOrder }
}

function mapSortForCreators(sort: SortValue): { sort_by: string, sort_order: string } {
  const sortBy = sort.sortBy === 'install_count' ? 'created_at' : sort.sortBy === 'version_updated_at' ? 'updated_at' : sort.sortBy
  return { sort_by: sortBy, sort_order: sort.sortOrder }
}

const SearchPage = () => {
  const { t } = useTranslation()
  const [searchText] = useSearchText()
  const debouncedQuery = useDebounce(searchText, { wait: 500 })
  const [searchTabParam, setSearchTab] = useSearchTab()
  const searchTab = (searchTabParam || 'all') as SearchTab
  const sort = useMarketplaceSortValue()

  const query = debouncedQuery === ZERO_WIDTH_SPACE ? '' : debouncedQuery.trim()
  const hasQuery = !!searchText && (!!query || searchText === ZERO_WIDTH_SPACE)

  const pluginsParams = useMemo(() => {
    if (!hasQuery)
      return undefined
    return {
      query,
      page_size: searchTab === 'all' ? ALL_TAB_PREVIEW_SIZE : PAGE_SIZE,
      sort_by: sort.sortBy,
      sort_order: sort.sortOrder,
      type: getPluginFilterType(PLUGIN_TYPE_SEARCH_MAP.all),
    } as PluginsSearchParams
  }, [hasQuery, query, searchTab, sort])

  const templatesParams = useMemo(() => {
    if (!hasQuery)
      return undefined
    const { sort_by, sort_order } = mapSortForTemplates(sort)
    return {
      query,
      page_size: searchTab === 'all' ? ALL_TAB_PREVIEW_SIZE : PAGE_SIZE,
      sort_by,
      sort_order,
    }
  }, [hasQuery, query, searchTab, sort])

  const creatorsParams = useMemo(() => {
    if (!hasQuery)
      return undefined
    const { sort_by, sort_order } = mapSortForCreators(sort)
    return {
      query,
      page_size: searchTab === 'all' ? ALL_TAB_PREVIEW_SIZE : PAGE_SIZE,
      sort_by,
      sort_order,
    }
  }, [hasQuery, query, searchTab, sort])

  const fetchPlugins = searchTab === 'all' || searchTab === 'plugins'
  const fetchTemplates = searchTab === 'all' || searchTab === 'templates'
  const fetchCreators = searchTab === 'all' || searchTab === 'creators'

  const pluginsQuery = useMarketplacePlugins(fetchPlugins ? pluginsParams : undefined)
  const templatesQuery = useMarketplaceTemplates(fetchTemplates ? templatesParams : undefined)
  const creatorsQuery = useMarketplaceCreators(fetchCreators ? creatorsParams : undefined)

  const plugins = pluginsQuery.data?.pages.flatMap(p => p.plugins) ?? []
  const pluginsTotal = pluginsQuery.data?.pages[0]?.total ?? 0
  const templates = useMemo(
    () => (templatesQuery.data?.pages.flatMap(p => p.templates) ?? []).map(mapTemplateDetailToTemplate),
    [templatesQuery.data],
  )
  const templatesTotal = templatesQuery.data?.pages[0]?.total ?? 0
  const creators = creatorsQuery.data?.pages.flatMap(p => p.creators) ?? []
  const creatorsTotal = creatorsQuery.data?.pages[0]?.total ?? 0

  const handleScrollLoadMore = useCallback(() => {
    if (searchTab === 'plugins' && pluginsQuery.hasNextPage && !pluginsQuery.isFetching)
      pluginsQuery.fetchNextPage()
    else if (searchTab === 'templates' && templatesQuery.hasNextPage && !templatesQuery.isFetching)
      templatesQuery.fetchNextPage()
    else if (searchTab === 'creators' && creatorsQuery.hasNextPage && !creatorsQuery.isFetching)
      creatorsQuery.fetchNextPage()
  }, [searchTab, pluginsQuery, templatesQuery, creatorsQuery])

  useMarketplaceContainerScroll(handleScrollLoadMore)

  const tabOptions = [
    { value: 'all', text: t('marketplace.searchFilterAll', { ns: 'plugin' }), count: pluginsTotal + templatesTotal + creatorsTotal },
    { value: 'templates', text: t('templates', { ns: 'plugin' }), count: templatesTotal },
    { value: 'plugins', text: t('plugins', { ns: 'plugin' }), count: pluginsTotal },
    { value: 'creators', text: t('marketplace.searchFilterCreators', { ns: 'plugin' }), count: creatorsTotal },
  ]

  const isLoading = (fetchPlugins && pluginsQuery.isLoading)
    || (fetchTemplates && templatesQuery.isLoading)
    || (fetchCreators && creatorsQuery.isLoading)
  const isFetchingNextPage = pluginsQuery.isFetchingNextPage
    || templatesQuery.isFetchingNextPage
    || creatorsQuery.isFetchingNextPage

  const renderPluginsSection = (items: Plugin[], limit?: number) => {
    const toShow = limit ? items.slice(0, limit) : items
    if (toShow.length === 0)
      return null
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {toShow.map(plugin => (
          <CardWrapper key={`${plugin.org}/${plugin.name}`} plugin={plugin} showInstallButton={false} />
        ))}
      </div>
    )
  }

  const renderTemplatesSection = (items: Template[], limit?: number) => {
    const toShow = limit ? items.slice(0, limit) : items
    if (toShow.length === 0)
      return null
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {toShow.map(template => (
          <div key={template.id}>
            <TemplateCard template={template} />
          </div>
        ))}
      </div>
    )
  }

  const renderCreatorsSection = (items: Creator[], limit?: number) => {
    const toShow = limit ? items.slice(0, limit) : items
    if (toShow.length === 0)
      return null
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {toShow.map(creator => (
          <CreatorCard key={creator.unique_handle} creator={creator} />
        ))}
      </div>
    )
  }

  const renderAllTab = () => (
    <div className="flex flex-col gap-8 py-4">
      {templates.length > 0 && (
        <section>
          <h3 className="title-xl-semi-bold mb-3 text-text-primary">
            {t('templates', { ns: 'plugin' })}
          </h3>
          {renderTemplatesSection(templates, ALL_TAB_PREVIEW_SIZE)}
        </section>
      )}
      {plugins.length > 0 && (
        <section>
          <h3 className="title-xl-semi-bold mb-3 text-text-primary">
            {t('plugins', { ns: 'plugin' })}
          </h3>
          {renderPluginsSection(plugins, ALL_TAB_PREVIEW_SIZE)}
        </section>
      )}
      {creators.length > 0 && (
        <section>
          <h3 className="title-xl-semi-bold mb-3 text-text-primary">
            {t('marketplace.searchFilterCreators', { ns: 'plugin' })}
          </h3>
          {renderCreatorsSection(creators, ALL_TAB_PREVIEW_SIZE)}
        </section>
      )}
      {!isLoading && plugins.length === 0 && templates.length === 0 && creators.length === 0 && (
        <Empty />
      )}
    </div>
  )

  const renderPluginsTab = () => {
    if (plugins.length === 0 && !pluginsQuery.isLoading)
      return <Empty />
    return (
      <div className="py-4">
        {renderPluginsSection(plugins)}
      </div>
    )
  }

  const renderTemplatesTab = () => {
    if (templates.length === 0 && !templatesQuery.isLoading)
      return <Empty text={t('marketplace.noTemplateFound', { ns: 'plugin' })} />
    return (
      <div className="py-4">
        {renderTemplatesSection(templates)}
      </div>
    )
  }

  const renderCreatorsTab = () => {
    if (creators.length === 0 && !creatorsQuery.isLoading)
      return <Empty text={t('marketplace.noCreatorFound', { ns: 'plugin' })} />
    return (
      <div className="py-4">
        {renderCreatorsSection(creators)}
      </div>
    )
  }

  return (
    <div
      style={{ scrollbarGutter: 'stable' }}
      className="relative flex grow flex-col bg-background-default-subtle px-12 py-2"
    >
      <div className="mb-4 flex items-center justify-between pt-3">
        <SegmentedControl
          size="large"
          activeState="accentLight"
          value={searchTab}
          onChange={v => setSearchTab(v as SearchTab)}
          options={tabOptions}
        />
        <SortDropdown />
      </div>

      {isLoading && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading />
        </div>
      )}

      {!isLoading && (
        <>
          {searchTab === 'all' && renderAllTab()}
          {searchTab === 'plugins' && renderPluginsTab()}
          {searchTab === 'templates' && renderTemplatesTab()}
          {searchTab === 'creators' && renderCreatorsTab()}
        </>
      )}

      {isFetchingNextPage && <Loading className="my-3" />}
    </div>
  )
}

export default SearchPage
