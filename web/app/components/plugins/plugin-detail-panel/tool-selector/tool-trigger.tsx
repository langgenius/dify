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
      'bg-components-input-bg-normal hover:bg-state-base-hover-alt group flex cursor-pointer items-center rounded-lg p-2 pl-3',
      open && 'bg-state-base-hover-alt',
      value?.provider_name && 'py-1.5 pl-1.5',
    )}>
      {value?.provider_name && provider && (
        <div className='bg-components-panel-bg border-components-panel-border mr-1 shrink-0 rounded-lg border p-px'>
          <BlockIcon
            className='!h-4 !w-4'
            type={BlockEnum.Tool}
            toolIcon={provider.icon}
          />
        </div>
      )}
      {value?.tool_name && (
        <div className='system-sm-medium text-components-input-text-filled grow'>{value.tool_name}</div>
      )}
      {!value?.provider_name && (
        <div className='text-components-input-text-placeholder system-sm-regular grow'>
          {!isConfigure ? t('plugin.detailPanel.toolSelector.placeholder') : t('plugin.detailPanel.configureTool')}
        </div>
      )}
      {isConfigure && (
        <RiEqualizer2Line className={cn('text-text-quaternary group-hover:text-text-secondary ml-0.5 h-4 w-4 shrink-0', open && 'text-text-secondary')} />
      )}
      {!isConfigure && (
        <RiArrowDownSLine className={cn('text-text-quaternary group-hover:text-text-secondary ml-0.5 h-4 w-4 shrink-0', open && 'text-text-secondary')} />
      )}
    </div>
  )
}

export default ToolTrigger
