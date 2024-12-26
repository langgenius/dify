'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  open: boolean
  provider?: ToolWithProvider
  value?: {
    provider_name: string
    tool_name: string
  }
  isConfigure?: boolean
}

const ToolTrigger = ({
  open,
  provider,
  value,
  isConfigure,
}: Props) => {
  const { t } = useTranslation()
  return (
    <div className={cn(
      'group flex items-center p-2 pl-3 bg-components-input-bg-normal rounded-lg cursor-pointer hover:bg-state-base-hover-alt',
      open && 'bg-state-base-hover-alt',
      value?.provider_name && 'pl-1.5 py-1.5',
    )}>
      {value?.provider_name && provider && (
        <div className='shrink-0 mr-1 p-px rounded-lg bg-components-panel-bg border border-components-panel-border'>
          <BlockIcon
            className='!w-4 !h-4'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          />
        </div>
      )}
      {value?.tool_name && (
        <div className='grow system-sm-medium text-components-input-text-filled'>{value.tool_name}</div>
      )}
      {!value?.provider_name && (
        <div className='grow text-components-input-text-placeholder system-sm-regular'>
          {!isConfigure ? t('plugin.detailPanel.toolSelector.placeholder') : t('plugin.detailPanel.configureTool')}
        </div>
      )}
      {isConfigure && (
        <RiEqualizer2Line className={cn('shrink-0 ml-0.5 w-4 h-4 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
      )}
      {!isConfigure && (
        <RiArrowDownSLine className={cn('shrink-0 ml-0.5 w-4 h-4 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
      )}
    </div>
  )
}

export default ToolTrigger
