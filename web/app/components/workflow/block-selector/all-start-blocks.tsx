'use client'
import {
  useMemo,
  useRef,
} from 'react'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'
import { useAllBuiltInTools } from '@/service/use-tools'
import StartBlocks from './start-blocks'
import TriggerPluginSelector from './trigger-plugin-selector'
import cn from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import Link from 'next/link'
import { RiArrowRightUpLine } from '@remixicon/react'
import { getMarketplaceUrl } from '@/utils/var'

type AllStartBlocksProps = {
  className?: string
  searchText: string
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
}

const AllStartBlocks = ({
  className,
  searchText,
  onSelect,
  availableBlocksTypes,
}: AllStartBlocksProps) => {
  const language = useGetLanguage()
  const { data: buildInTools = [] } = useAllBuiltInTools()
  const wrapElemRef = useRef<HTMLDivElement>(null)

  // Filter trigger plugins based on search text
  const triggerPlugins = useMemo(() => {
    return buildInTools.filter((toolWithProvider) => {
      // For now, assume all plugins can be triggers
      // This will be refined when backend provides trigger capability info
      return toolWithProvider.tools.length > 0
    }).filter((toolWithProvider) => {
      if (!searchText) return true
      return toolWithProvider.name.toLowerCase().includes(searchText.toLowerCase())
        || toolWithProvider.tools.some(tool =>
          tool.label[language].toLowerCase().includes(searchText.toLowerCase()),
        )
    })
  }, [buildInTools, searchText, language])

  const hasTriggerPlugins = triggerPlugins.length > 0

  return (
    <div className={cn('min-w-[400px] max-w-[500px]', className)}>
      <div
        ref={wrapElemRef}
        className='max-h-[464px] overflow-y-auto'
      >
        <StartBlocks
          searchText={searchText}
          onSelect={onSelect}
          availableBlocksTypes={availableBlocksTypes}
        />

        {hasTriggerPlugins && (
          <TriggerPluginSelector
            onSelect={onSelect}
            searchText={searchText}
          />
        )}
      </div>

      {/* Footer - Find more triggers in marketplace */}
      <Link
        className='system-sm-medium sticky bottom-0 z-10 flex h-8 cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'
        href={getMarketplaceUrl('', { category: 'trigger' })}
        target='_blank'
      >
        <span>Find more triggers in marketplace</span>
        <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
      </Link>
    </div>
  )
}

export default AllStartBlocks
