import {
  useRef,
} from 'react'
import type {
  OnSelectBlock,
  ToolWithProvider,
} from '../types'
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
          onSelect={onSelect}
          viewType={ViewType.flat}
          hasSearchText={!!searchText}
        />
      </div>
    </div>
  )
}

export default DataSources
