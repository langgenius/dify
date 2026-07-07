'use client'
import type { RemixiconComponentType } from '@remixicon/react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'

export type NavIcon = React.ComponentType<
  React.PropsWithoutRef<React.ComponentProps<'svg'>> & {
    title?: string | undefined
    titleId?: string | undefined
  }
> | RemixiconComponentType

export type NavLinkProps = {
  name: string
  href?: string
  iconMap: {
    selected: NavIcon
    normal: NavIcon
  }
  mode?: string
  disabled?: boolean
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
  pathname,
  active,
  onClick,
}: NavLinkProps) => {
  const segment = useSelectedLayoutSegment()
  const formatSegment = (value?: string | null) => {
    const res = value?.toLowerCase()

    return !pathname && res === 'annotations' ? 'logs' : res
  }
  const formattedSegment = formatSegment(pathname ? pathname.split('/').filter(Boolean).pop() : segment)
  const isActive = active ?? (href ? href.toLowerCase().split('/')?.pop() === formattedSegment : false)
  const NavIcon = isActive ? iconMap.selected : iconMap.normal

  const isCollapsed = mode !== 'expand'
  const borderClassName = 'border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px]'
  const linkClassName = cn(
    borderClassName,
    isActive
      ? 'border-effects-highlight-lightmode-off bg-components-menu-item-bg-active system-sm-semibold text-text-accent-light-mode-only'
      : 'border-transparent system-sm-medium text-components-menu-item-text hover:bg-components-menu-item-bg-hover hover:text-components-menu-item-text-hover',
    isCollapsed ? 'flex size-8 items-center justify-center p-1.5' : 'flex h-8 items-center rounded-lg pr-1 pl-3',
    'rounded-lg',
  )

  const renderIcon = () => (
    <div className="flex size-5 items-center justify-center">
      <NavIcon className="size-[18px] shrink-0" aria-hidden="true" />
    </div>
  )

  if (disabled) {
    return (
      <button
        key={name}
        type="button"
        disabled
        className={cn(
          borderClassName,
          'cursor-not-allowed rounded-lg system-sm-medium text-components-menu-item-text opacity-30 hover:bg-components-menu-item-bg-hover',
          'border-transparent',
          isCollapsed ? 'flex size-8 items-center justify-center p-1.5' : 'flex h-8 items-center pr-1 pl-3',
        )}
        title={mode === 'collapse' ? name : ''}
        aria-disabled
      >
        {renderIcon()}
        <span
          className={cn('overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out', mode === 'expand'
            ? 'ml-2 max-w-none opacity-100'
            : 'ml-0 max-w-0 opacity-0')}
        >
          {name}
        </span>
      </button>
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
          className={cn('overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out', mode === 'expand'
            ? 'ml-2 max-w-none opacity-100'
            : 'ml-0 max-w-0 opacity-0')}
        >
          {name}
        </span>
      </button>
    )
  }

  return (
    <Link
      key={name}
      href={href}
      className={linkClassName}
      title={mode === 'collapse' ? name : ''}
    >
      {renderIcon()}
      <span
        className={cn('overflow-hidden whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out', mode === 'expand'
          ? 'ml-2 max-w-none opacity-100'
          : 'ml-0 max-w-0 opacity-0')}
      >
        {name}
      </span>
    </Link>
  )
}

export default React.memo(NavLink)
