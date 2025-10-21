import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { BlockEnum } from '../types'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { DataSourceDefaultValue, ToolDefaultValue } from './types'
import Tools from './tools'
import { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import PluginList, { type ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from './constants'
import { useMarketplacePlugins } from '../../plugins/marketplace/hooks'
import { PluginType } from '../../plugins/types'
import { useGetLanguage } from '@/context/i18n'

type AllToolsProps = {
  className?: string
  toolContentClassName?: string
  searchText: string
  onSelect: OnSelectBlock
  dataSources: ToolWithProvider[]
}

const DataSources = ({
  className,
  toolContentClassName,
  searchText,
  onSelect,
  dataSources,
}: AllToolsProps) => {
  const language = useGetLanguage()
  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)

  const isMatchingKeywords = (text: string, keywords: string) => {
    return text.toLowerCase().includes(keywords.toLowerCase())
  }

  const filteredDatasources = useMemo(() => {
    const hasFilter = searchText
    if (!hasFilter)
      return dataSources.filter(toolWithProvider => toolWithProvider.tools.length > 0)

    return dataSources.filter((toolWithProvider) => {
      return isMatchingKeywords(toolWithProvider.name, searchText) || toolWithProvider.tools.some((tool) => {
        return tool.label[language].toLowerCase().includes(searchText.toLowerCase()) || tool.name.toLowerCase().includes(searchText.toLowerCase())
      })
    })
  }, [searchText, dataSources, language])

  const handleSelect = useCallback((_: any, toolDefaultValue: ToolDefaultValue) => {
    let defaultValue: DataSourceDefaultValue = {
      plugin_id: toolDefaultValue?.provider_id,
      provider_type: toolDefaultValue?.provider_type,
      provider_name: toolDefaultValue?.provider_name,
      datasource_name: toolDefaultValue?.tool_name,
      datasource_label: toolDefaultValue?.tool_label,
      title: toolDefaultValue?.title,
    }
    // Update defaultValue with fileExtensions if this is the local file data source
    if (toolDefaultValue?.provider_id === 'langgenius/file' && toolDefaultValue?.provider_name === 'file') {
      defaultValue = {
        ...defaultValue,
        fileExtensions: DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE,
      }
    }
    onSelect(BlockEnum.DataSource, toolDefaultValue && defaultValue)
  }, [onSelect])

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  useEffect(() => {
    if (!enable_marketplace) return
    if (searchText) {
      fetchPlugins({
        query: searchText,
        category: PluginType.datasource,
      })
    }
  }, [searchText, enable_marketplace])

  return (
    <div className={cn(className)}>
      <div
        ref={wrapElemRef}
        className='max-h-[464px] overflow-y-auto'
        onScroll={pluginRef.current?.handleScroll}
      >
        <Tools
          className={toolContentClassName}
          tools={filteredDatasources}
          onSelect={handleSelect as OnSelectBlock}
          viewType={ViewType.flat}
          hasSearchText={!!searchText}
          canNotSelectMultiple
        />
        {/* Plugins from marketplace */}
        {enable_marketplace && (
          <PluginList
            ref={pluginRef}
            wrapElemRef={wrapElemRef}
            list={notInstalledPlugins}
            tags={[]}
            searchText={searchText}
            toolContentClassName={toolContentClassName}
          />
        )}
      </div>
    </div>
  )
}

export default DataSources
