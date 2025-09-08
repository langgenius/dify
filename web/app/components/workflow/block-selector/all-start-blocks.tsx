'use client'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockEnum, OnSelectBlock } from '../types'
import type { TriggerDefaultValue } from './types'
import StartBlocks from './start-blocks'
import TriggerPluginSelector from './trigger-plugin-selector'
import { ENTRY_NODE_TYPES } from './constants'
import cn from '@/utils/classnames'
import Link from 'next/link'
import { RiArrowRightUpLine } from '@remixicon/react'
import { getMarketplaceUrl } from '@/utils/var'
import Button from '@/app/components/base/button'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'

type AllStartBlocksProps = {
  className?: string
  searchText: string
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  tags?: string[]
}

const AllStartBlocks = ({
  className,
  searchText,
  onSelect,
  availableBlocksTypes,
  tags = [],
}: AllStartBlocksProps) => {
  const { t } = useTranslation()
  const wrapElemRef = useRef<HTMLDivElement>(null)
  const [hasStartBlocksContent, setHasStartBlocksContent] = useState(false)
  const [hasPluginContent, setHasPluginContent] = useState(false)

  const handleStartBlocksContentChange = useCallback((hasContent: boolean) => {
    setHasStartBlocksContent(hasContent)
  }, [])

  const handlePluginContentChange = useCallback((hasContent: boolean) => {
    setHasPluginContent(hasContent)
  }, [])

  const hasAnyContent = hasStartBlocksContent || hasPluginContent
  const shouldShowEmptyState = searchText && !hasAnyContent

  return (
    <div className={cn('min-w-[400px] max-w-[500px]', className)}>
      <div
        ref={wrapElemRef}
        className='h-[640px] max-h-[640px] overflow-y-auto'
      >
        {shouldShowEmptyState && (
          <div className='flex flex-col items-center gap-1 pt-48'>
            <SearchMenu className='h-8 w-8 text-text-quaternary' />
            <div className='text-sm font-medium text-text-secondary'>
              {t('workflow.tabs.noPluginsFound')}
            </div>
            <Link
              href='https://github.com/langgenius/dify-plugins/issues'
              target='_blank'
            >
              <Button
                size='small'
                variant='secondary-accent'
                className='h-6 px-3 text-xs'
              >
                {t('workflow.tabs.requestToCommunity')}
              </Button>
            </Link>
          </div>
        )}

        {!shouldShowEmptyState && (
          <>
            <StartBlocks
              searchText={searchText}
              onSelect={onSelect as OnSelectBlock}
              availableBlocksTypes={ENTRY_NODE_TYPES as unknown as BlockEnum[]}
              onContentStateChange={handleStartBlocksContentChange}
            />

            <TriggerPluginSelector
              onSelect={onSelect}
              searchText={searchText}
              onContentStateChange={handlePluginContentChange}
              tags={tags}
            />
          </>
        )}
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
