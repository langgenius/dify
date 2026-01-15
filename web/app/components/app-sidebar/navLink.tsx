'use client'
import type { RemixiconComponentType } from '@remixicon/react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import * as React from 'react'
import { cn } from '@/utils/classnames'

export type NavIcon = React.ComponentType<
  React.PropsWithoutRef<React.ComponentProps<'svg'>> & {
    title?: string | undefined
    titleId?: string | undefined
  }
> | RemixiconComponentType

export type NavLinkProps = {
  name: string
  href: string
  iconMap: {
    selected: NavIcon
    normal: NavIcon
  }
  mode?: string
  disabled?: boolean
}

const NavLink = ({
  name,
  href,
  iconMap,
  mode = 'expand',
  disabled = false,
}: NavLinkProps) => {
  const segment = useSelectedLayoutSegment()
  const formattedSegment = (() => {
    let res = segment?.toLowerCase()
    // logs and annotations use the same nav
    if (res === 'annotations')
      res = 'logs'

    return res
  })()
  const isActive = href.toLowerCase().split('/')?.pop() === formattedSegment
  const NavIcon = isActive ? iconMap.selected : iconMap.normal

  const renderIcon = () => (
    <div className={cn(mode !== 'expand' && '-ml-1')}>
      <NavIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
    </div>
  )

  if (disabled) {
    return (
      <button
        key={name}
        type="button"
        disabled
        className={cn('system-sm-medium flex h-8 cursor-not-allowed items-center rounded-lg text-components-menu-item-text opacity-30 hover:bg-components-menu-item-bg-hover', 'pl-3 pr-1')}
        title={mode === 'collapse' ? name : ''}
        aria-disabled
      >
        {renderIcon()}
        <span
          className={cn('overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out', mode === 'expand'
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
      className={cn(isActive
        ? 'system-sm-semibold border-b-[0.25px] border-l-[0.75px] border-r-[0.25px] border-t-[0.75px] border-effects-highlight-lightmode-off bg-components-menu-item-bg-active text-text-accent-light-mode-only'
        : 'system-sm-medium text-components-menu-item-text hover:bg-components-menu-item-bg-hover hover:text-components-menu-item-text-hover', 'flex h-8 items-center rounded-lg pl-3 pr-1')}
      title={mode === 'collapse' ? name : ''}
    >
      {renderIcon()}
      <span
        className={cn('overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out', mode === 'expand'
          ? 'ml-2 max-w-none opacity-100'
          : 'ml-0 max-w-0 opacity-0')}
      >
        {name}
      </span>
    </Link>
  )
}

export default React.memo(NavLink)
