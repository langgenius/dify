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
      'group flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal p-2 pl-3 hover:bg-state-base-hover-alt',
      open && 'bg-state-base-hover-alt',
      value?.provider_name && 'py-1.5 pl-1.5',
    )}>
      {value?.provider_name && provider && (
        <div className='mr-1 shrink-0 rounded-lg border border-components-panel-border bg-components-panel-bg p-px'>
          <BlockIcon
            className='!h-4 !w-4'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          />
        </div>
      )}
      {value?.tool_name && (
        <div className='system-sm-medium grow text-components-input-text-filled'>{value.tool_name}</div>
      )}
      {!value?.provider_name && (
        <div className='system-sm-regular grow text-components-input-text-placeholder'>
          {!isConfigure ? t('plugin.detailPanel.toolSelector.placeholder') : t('plugin.detailPanel.configureTool')}
        </div>
      )}
      {isConfigure && (
        <RiEqualizer2Line className={cn('ml-0.5 h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
      )}
      {!isConfigure && (
        <RiArrowDownSLine className={cn('ml-0.5 h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
      )}
    </div>
  )
}

export default ToolTrigger
