import {
  useCallback,
  useRef,
} from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'
import { BlockEnum } from '../types'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { DataSourceDefaultValue, ToolDefaultValue } from './types'
import Tools from './tools'
import { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import type { ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { getMarketplaceUrl } from '@/utils/var'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE } from './constants'

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
  const { t } = useTranslation()
  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)
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

  return (
    <div className={cn(className)}>
      <div
        ref={wrapElemRef}
        className='max-h-[464px] overflow-y-auto'
        onScroll={pluginRef.current?.handleScroll}
      >
        <Tools
          className={toolContentClassName}
          tools={dataSources}
          onSelect={handleSelect as OnSelectBlock}
          viewType={ViewType.flat}
          hasSearchText={!!searchText}
          canNotSelectMultiple
        />
        {
          enable_marketplace && (
            <Link
              className='system-sm-medium sticky bottom-0 z-10 flex h-8 cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'
              href={getMarketplaceUrl('')}
              target='_blank'
            >
              <span>{t('plugin.findMoreInMarketplace')}</span>
              <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
            </Link>
          )
        }
      </div>
    </div>
  )
}

export default DataSources
