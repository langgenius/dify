'use client'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'
import StartBlocks from './start-blocks'
import TriggerPluginSelector from './trigger-plugin-selector'
import { ENTRY_NODE_TYPES } from './constants'
import cn from '@/utils/classnames'
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
  const { t } = useTranslation()
  const wrapElemRef = useRef<HTMLDivElement>(null)

  return (
    <div className={cn('min-w-[400px] max-w-[500px]', className)}>
      <div
        ref={wrapElemRef}
        className='h-[640px] max-h-[640px] overflow-y-auto'
      >
        <StartBlocks
          searchText={searchText}
          onSelect={onSelect}
          availableBlocksTypes={ENTRY_NODE_TYPES as unknown as BlockEnum[]}
        />

        <TriggerPluginSelector
          onSelect={onSelect}
          searchText={searchText}
        />
      </div>

      {/* Footer - Same as Tools tab marketplace footer */}
      <Link
        className='system-sm-medium sticky bottom-0 z-10 flex h-8 cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'
        href={getMarketplaceUrl('')}
        target='_blank'
      >
        <span>{t('plugin.findMoreInMarketplace')}</span>
        <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
      </Link>
    </div>
  )
}

export default AllStartBlocks
