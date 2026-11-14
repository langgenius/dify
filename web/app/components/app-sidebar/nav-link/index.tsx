'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'

export type NavLinkProps = {
  name: string
  href?: string
  iconMap: {
    selected: string
    normal: string
  }
  mode?: string
  disabled?: boolean
  /** Why the item is disabled; shown on hover and focus. */
  disabledReason?: string
  pathname?: string
  active?: boolean
  onClick?: () => void
}

const NavLink = ({
  name,
  href,
  iconMap,
  mode = 'expand',
  disabled = false,
  disabledReason,
  pathname,
  active,
  onClick,
}: NavLinkProps) => {
  const segment = useSelectedLayoutSegment()
  const formatSegment = (value?: string | null) => {
    const res = value?.toLowerCase()

    return !pathname && res === 'annotations' ? 'logs' : res
  }
  const formattedSegment = formatSegment(
    pathname ? pathname.split('/').filter(Boolean).pop() : segment,
  )
  const isActive =
    active ?? (href ? href.toLowerCase().split('/')?.pop() === formattedSegment : false)
  const iconClassName = isActive ? iconMap.selected : iconMap.normal

  const isCollapsed = mode !== 'expand'
  const borderClassName = 'border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px]'
  const linkClassName = cn(
    borderClassName,
    isActive
      ? 'border-effects-highlight-lightmode-off bg-components-menu-item-bg-active system-sm-semibold text-text-accent-light-mode-only'
      : 'border-transparent system-sm-medium text-components-menu-item-text hover:bg-components-menu-item-bg-hover hover:text-components-menu-item-text-hover',
    isCollapsed
      ? 'flex size-8 items-center justify-center p-1.5'
      : 'flex h-8 items-center rounded-lg ps-3 pe-1',
    'rounded-lg',
    'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
  )

  const renderIcon = () => (
    <div className="flex size-5 items-center justify-center">
      <span aria-hidden className={cn('size-4.5 shrink-0', iconClassName)} />
    </div>
  )

  if (disabled) {
    const disabledItem = (
      <button
        key={name}
        type="button"
        // aria-disabled keeps the item focusable and hoverable, so its reason can be shown.
        disabled={!disabledReason}
        className={cn(
          borderClassName,
          'cursor-not-allowed rounded-lg system-sm-medium text-components-menu-item-text opacity-30 hover:bg-components-menu-item-bg-hover',
          'border-transparent',
          isCollapsed
            ? 'flex size-8 items-center justify-center p-1.5'
            : 'flex h-8 items-center ps-3 pe-1',
        )}
        title={mode === 'collapse' ? name : ''}
        aria-disabled
      >
        {renderIcon()}
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out',
            mode === 'expand' ? 'ms-2 max-w-none opacity-100' : 'ms-0 max-w-0 opacity-0',
          )}
        >
          {name}
        </span>
      </button>
    )

    if (!disabledReason) return disabledItem

    return (
      <Tooltip>
        <TooltipTrigger render={disabledItem} />
        <TooltipContent side="right">{disabledReason}</TooltipContent>
      </Tooltip>
    )
  }

  if (!href) {
    return (
      <button
        key={name}
        type="button"
        className={linkClassName}
        title={mode === 'collapse' ? name : ''}
        onClick={onClick}
      >
        {renderIcon()}
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out',
            mode === 'expand' ? 'ms-2 max-w-none opacity-100' : 'ms-0 max-w-0 opacity-0',
          )}
        >
          {name}
        </span>
      </button>
    )
  }

  return (
    <Link key={name} href={href} className={linkClassName} title={mode === 'collapse' ? name : ''}>
      {renderIcon()}
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out',
          mode === 'expand' ? 'ms-2 max-w-none opacity-100' : 'ms-0 max-w-0 opacity-0',
        )}
      >
        {name}
      </span>
    </Link>
  )
}

export default React.memo(NavLink)
