'use client'
import React from 'react'
import { RiListUnordered, RiNodeTree } from '@remixicon/react'
import { OnlineDriveViewMode } from '@/models/pipeline'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type ViewToggleProps = {
  viewMode: OnlineDriveViewMode
  onChange: (mode: OnlineDriveViewMode) => void
}

const ViewToggle = ({ viewMode, onChange }: ViewToggleProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex shrink-0 items-center gap-0.5 rounded-lg border border-divider-subtle bg-background-body p-0.5'>
      <Tooltip popupContent={t('datasetPipeline.onlineDrive.viewMode.flatList')}>
        <button
          type='button'
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            viewMode === OnlineDriveViewMode.flat
              ? 'bg-components-button-secondary-bg text-text-secondary shadow-xs'
              : 'text-text-tertiary hover:bg-state-base-hover',
          )}
          onClick={() => onChange(OnlineDriveViewMode.flat)}
        >
          <RiListUnordered className='h-4 w-4' />
        </button>
      </Tooltip>

      <Tooltip popupContent={t('datasetPipeline.onlineDrive.viewMode.treeView')}>
        <button
          type='button'
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            viewMode === OnlineDriveViewMode.tree
              ? 'bg-components-button-secondary-bg text-text-secondary shadow-xs'
              : 'text-text-tertiary hover:bg-state-base-hover',
          )}
          onClick={() => onChange(OnlineDriveViewMode.tree)}
        >
          <RiNodeTree className='h-4 w-4' />
        </button>
      </Tooltip>
    </div>
  )
}

export default React.memo(ViewToggle)
