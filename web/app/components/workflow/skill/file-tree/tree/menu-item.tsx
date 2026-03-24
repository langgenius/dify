'use client'

import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import {
  ContextMenuItem,
} from '@/app/components/base/ui/context-menu'
import {
  DropdownMenuItem,
} from '@/app/components/base/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/base/ui/tooltip'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { cn } from '@/utils/classnames'

const menuItemVariants = cva(
  [
    'flex w-full items-center gap-2 rounded-lg px-3 py-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
  ],
  {
    variants: {
      variant: {
        default: 'hover:bg-state-base-hover',
        destructive: 'group hover:bg-state-destructive-hover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const iconVariants = cva('size-4 text-text-tertiary', {
  variants: {
    variant: {
      default: '',
      destructive: 'group-hover:text-text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

const labelVariants = cva('text-text-secondary system-sm-regular', {
  variants: {
    variant: {
      default: '',
      destructive: 'group-hover:text-text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type MenuItemProps = {
  menuType: 'dropdown' | 'context'
  icon: React.ElementType | string
  label: string
  kbd?: readonly string[]
  onClick: () => void
  disabled?: boolean
  tooltip?: string
} & VariantProps<typeof menuItemVariants>

const MenuItem = ({
  menuType,
  icon: Icon,
  label,
  kbd,
  onClick,
  disabled,
  variant,
  tooltip,
}: MenuItemProps) => {
  const ItemComponent = menuType === 'dropdown' ? DropdownMenuItem : ContextMenuItem

  return (
    <ItemComponent
      onClick={onClick}
      disabled={disabled}
      destructive={variant === 'destructive'}
      className={cn(menuItemVariants({ variant }), 'h-auto')}
    >
      {typeof Icon === 'string'
        ? <span className={cn(Icon, iconVariants({ variant }))} aria-hidden="true" />
        : <Icon className={cn(iconVariants({ variant }))} aria-hidden="true" />}
      <span className={cn(labelVariants({ variant }), 'flex-1 text-left')}>{label}</span>
      {kbd && kbd.length > 0 && <ShortcutsName keys={kbd} textColor="secondary" />}
      {tooltip && (
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={tooltip}
            className="flex shrink-0 items-center justify-center rounded text-text-quaternary hover:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <span className="i-ri-question-line size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent placement="right">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )}
    </ItemComponent>
  )
}

export default React.memo(MenuItem)
