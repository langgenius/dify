import type {
  DatasourceEntity,
  RagPipelineDatasourceProviderResponse,
} from '@dify/contracts/api/console/rag/types.gen'
import type { OnSelectBlock } from '../types'
import type { DataSourceDefaultValue } from './types'
import type { ListRef } from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import dynamic from 'next/dynamic'
import { useCallback, useMemo, useRef } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import PluginList from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n/metadata'
import { PluginCategoryEnum } from '../../plugins/types'
import { BlockEnum } from '../types'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from './constants'

const DatasourceList = dynamic(
  () => import('./datasource-list').then((module) => module.DatasourceList),
  {
    loading: () => <div className="h-24 animate-pulse rounded-lg bg-background-section" />,
  },
)

type DataSourcesProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  onSelect: OnSelectBlock
  dataSources: RagPipelineDatasourceProviderResponse[]
}

function DataSources({
  className,
  toolContentClassName,
  searchText,
  onSelect,
  dataSources,
}: DataSourcesProps) {
  const language = useGetLanguage()
  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)

  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }

  const filteredDatasources = useMemo(() => {
    return dataSources.filter((provider) => {
      const datasources = provider.declaration.datasources ?? []
      if (!searchText) return datasources.length > 0
      return (
        isMatchingKeywords(provider.provider, searchText) ||
        datasources.some(
          (datasource) =>
            isMatchingKeywords(renderI18nObject(datasource.identity.label, language), searchText) ||
            isMatchingKeywords(datasource.identity.name, searchText),
        )
      )
    })
  }, [searchText, dataSources, language])

  const handleSelect = useCallback(
    (provider: RagPipelineDatasourceProviderResponse, datasource: DatasourceEntity) => {
      const label = renderI18nObject(datasource.identity.label, language)
      const defaultValue: DataSourceDefaultValue = {
        plugin_id: provider.plugin_id,
        provider_type: provider.declaration.provider_type,
        provider_name: provider.provider,
        datasource_name: datasource.identity.name,
        datasource_label: label,
        title: label,
        plugin_unique_identifier: provider.plugin_unique_identifier,
        ...(provider.plugin_id === 'langgenius/file' && provider.provider === 'file'
          ? { fileExtensions: DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE }
          : {}),
      }
      onSelect(BlockEnum.DataSource, defaultValue)
      trackEvent('tool_selected', {
        tool_name: datasource.identity.name,
        plugin_id: provider.plugin_id,
      })
    },
    [onSelect, language],
  )

  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })

  const trimmedSearchText = searchText.trim()
  const debouncedMarketplaceSearchText = useDebounce(trimmedSearchText, { wait: 500 })
  const isMarketplaceSearchSettled = debouncedMarketplaceSearchText === trimmedSearchText
  const marketplaceSearchParams = useMemo(
    () =>
      enable_marketplace && trimmedSearchText && isMarketplaceSearchSettled
        ? {
            query: debouncedMarketplaceSearchText,
            category: PluginCategoryEnum.datasource,
          }
        : undefined,
    [
      debouncedMarketplaceSearchText,
      enable_marketplace,
      isMarketplaceSearchSettled,
      trimmedSearchText,
    ],
  )
  const { data: marketplacePluginsData } = useMarketplacePlugins(marketplaceSearchParams)
  const notInstalledPlugins = useMemo(
    () => marketplacePluginsData?.pages.flatMap((page) => page.plugins) ?? [],
    [marketplacePluginsData?.pages],
  )

  return (
    <div className={cn('w-100 max-w-full min-w-0', className)}>
      <div
        ref={wrapElemRef}
        className="max-h-116 overflow-x-hidden overflow-y-auto"
        onScroll={() => pluginRef.current?.handleScroll()}
      >
        <DatasourceList
          className={toolContentClassName}
          providers={filteredDatasources}
          onSelect={handleSelect}
          hasSearchText={!!searchText}
        />
        {enable_marketplace && (
          <PluginList
            ref={pluginRef}
            wrapElemRef={wrapElemRef}
            list={notInstalledPlugins}
            tags={[]}
            searchText={trimmedSearchText}
            category={PluginCategoryEnum.datasource}
            toolContentClassName={toolContentClassName}
          />
        )}
      </div>
    </div>
  )
}

export default DataSources
