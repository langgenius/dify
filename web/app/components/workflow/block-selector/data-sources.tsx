import type { OnSelectBlock, ToolWithProvider } from '../types'
import type { DataSourceDefaultValue, ToolDefaultValue } from './types'
import type { ListRef } from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useCallback, useMemo, useRef } from 'react'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import PluginList from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { PluginCategoryEnum } from '../../plugins/types'
import { BlockEnum } from '../types'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from './constants'
import Tools from './tools'
import { ViewType } from './types'

type DataSourcesProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  onSelect: OnSelectBlock
  dataSources: ToolWithProvider[]
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
    const hasFilter = searchText
    if (!hasFilter)
      return dataSources.filter((toolWithProvider) => toolWithProvider.tools.length > 0)

    return dataSources.filter((toolWithProvider) => {
      return (
        isMatchingKeywords(toolWithProvider.name, searchText) ||
        toolWithProvider.tools.some((tool) => {
          return (
            tool.label[language]!.toLowerCase().includes(searchText.toLowerCase()) ||
            tool.name.toLowerCase().includes(searchText.toLowerCase())
          )
        })
      )
    })
  }, [searchText, dataSources, language])

  const handleSelect = useCallback(
    (_: BlockEnum, toolDefaultValue: ToolDefaultValue) => {
      let defaultValue: DataSourceDefaultValue = {
        plugin_id: toolDefaultValue?.provider_id,
        provider_type: toolDefaultValue?.provider_type,
        provider_name: toolDefaultValue?.provider_name,
        datasource_name: toolDefaultValue?.tool_name,
        datasource_label: toolDefaultValue?.tool_label,
        title: toolDefaultValue?.title,
        plugin_unique_identifier: toolDefaultValue?.plugin_unique_identifier,
      }
      if (
        toolDefaultValue?.provider_id === 'langgenius/file' &&
        toolDefaultValue?.provider_name === 'file'
      ) {
        defaultValue = {
          ...defaultValue,
          fileExtensions: DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE,
        }
      }
      onSelect(BlockEnum.DataSource, toolDefaultValue && defaultValue)
    },
    [onSelect],
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
    <div className={cn('w-[400px] max-w-full min-w-0', className)}>
      <div
        ref={wrapElemRef}
        className="max-h-[464px] overflow-x-hidden overflow-y-auto"
        onScroll={() => pluginRef.current?.handleScroll()}
      >
        <Tools
          className={toolContentClassName}
          tools={filteredDatasources}
          onSelect={handleSelect as OnSelectBlock}
          viewType={ViewType.flat}
          hasSearchText={!!searchText}
          canNotSelectMultiple
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
