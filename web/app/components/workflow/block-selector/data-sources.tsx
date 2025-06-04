import {
  useCallback,
  useRef,
} from 'react'
import { BlockEnum } from '../types'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
import type { ToolDefaultValue } from './types'
import Tools from './tools'
import { ViewType } from './view-type-select'
import cn from '@/utils/classnames'
import type { ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'

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
  const pluginRef = useRef<ListRef>(null)
  const wrapElemRef = useRef<HTMLDivElement>(null)
  const handleSelect = useCallback((_: any, toolDefaultValue: ToolDefaultValue) => {
    onSelect(BlockEnum.DataSource, toolDefaultValue && {
      provider_id: toolDefaultValue?.provider_id,
      provider_type: toolDefaultValue?.provider_type,
      provider_name: toolDefaultValue?.provider_name,
      datasource_name: toolDefaultValue?.tool_name,
      datasource_label: toolDefaultValue?.tool_label,
      title: toolDefaultValue?.title,
    })
  }, [onSelect])

  return (
    <div className={cn(className)}>
      <div
        ref={wrapElemRef}
        className='max-h-[464px] overflow-y-auto'
        onScroll={pluginRef.current?.handleScroll}
      >
        <Tools
          className={toolContentClassName}
          showWorkflowEmpty={false}
          tools={dataSources}
          onSelect={handleSelect as OnSelectBlock}
          viewType={ViewType.flat}
          hasSearchText={!!searchText}
        />
      </div>
    </div>
  )
}

export default DataSources
