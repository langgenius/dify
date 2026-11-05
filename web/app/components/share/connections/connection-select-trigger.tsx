'use client'

import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import Badge from '@/app/components/base/badge'

type Props = Omit<ComponentProps<typeof Button>, 'children'> & {
  connectionName: string
  nameId?: string
  methodLabel?: string
  methodId?: string
  warning?: boolean
}

export default function ConnectionSelectTrigger({
  connectionName,
  nameId,
  methodLabel,
  methodId,
  warning = false,
  disabled,
  className,
  ...props
}: Props) {
  return (
    <Button
      variant="ghost"
      focusableWhenDisabled
      {...props}
      disabled={disabled}
      className={cn(
        'flex h-8 w-40 max-w-full items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 system-sm-regular text-components-input-text-filled hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
        'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
        methodLabel && 'w-50',
        methodLabel && disabled && 'opacity-45',
        warning &&
          'bg-state-warning-hover inset-ring-1 inset-ring-text-warning hover:bg-state-warning-hover data-popup-open:bg-state-warning-hover',
        className,
      )}
    >
      {warning && (
        <span className="i-ri-alert-fill size-4 shrink-0 text-text-warning" aria-hidden="true" />
      )}
      <span
        id={nameId}
        className={cn('min-w-0 flex-1 truncate text-start', !methodLabel && 'px-1')}
      >
        {connectionName}
      </span>
      {methodLabel && (
        <span id={methodId} className="shrink-0">
          <Badge
            as="span"
            size="xs"
            variant="dimm"
            uppercase={false}
            className="min-w-4.5 px-1.25 py-0.75 text-[10px] leading-3 font-medium"
          >
            {methodLabel}
          </Badge>
        </span>
      )}
      <span
        className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary"
        aria-hidden="true"
      />
    </Button>
  )
}
