'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = Readonly<
  {
    open: boolean
    provider?: ToolWithProvider
    value?: {
      provider_name: string
      tool_name: string
    }
    isConfigure?: boolean
  } & Omit<ButtonProps, 'children' | 'size' | 'value' | 'variant'>
>

export function ToolTrigger({
  open,
  provider,
  value,
  isConfigure,
  className,
  ...buttonProps
}: Props) {
  const { t } = useTranslation()
  return (
    <Button
      {...buttonProps}
      variant="ghost"
      size="medium"
      className={cn(
        'group w-full justify-start bg-components-input-bg-normal px-3 hover:bg-state-base-hover-alt focus-visible:ring-inset',
        open && 'bg-state-base-hover-alt',
        value?.provider_name && 'py-1.5 pl-1.5',
        className,
      )}
    >
      {value?.provider_name && provider && (
        <div className="mr-1 shrink-0 rounded-lg border border-components-panel-border bg-components-panel-bg p-px">
          <BlockIcon className="size-4!" type={BlockEnum.Tool} toolIcon={provider.icon} />
        </div>
      )}
      {value?.tool_name && (
        <div className="grow system-sm-medium text-components-input-text-filled">
          {value.tool_name}
        </div>
      )}
      {!value?.provider_name && (
        <div className="grow system-sm-regular text-components-input-text-placeholder">
          {!isConfigure
            ? t(($) => $['detailPanel.toolSelector.placeholder'], { ns: 'plugin' })
            : t(($) => $['detailPanel.configureTool'], { ns: 'plugin' })}
        </div>
      )}
      {isConfigure && (
        <span
          aria-hidden
          className={cn(
            'ml-0.5 i-ri-equalizer-2-line size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
            open && 'text-text-secondary',
          )}
        />
      )}
      {!isConfigure && (
        <span
          aria-hidden
          className={cn(
            'ml-0.5 i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
            open && 'text-text-secondary',
          )}
        />
      )}
    </Button>
  )
}
