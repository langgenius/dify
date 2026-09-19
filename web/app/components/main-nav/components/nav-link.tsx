'use client'

import type { ReactNode } from 'react'
import type { MainNavItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

const NavIcon = ({ icon, className }: { icon: string; className?: string }) => (
  <span aria-hidden className={cn(icon, 'h-5 w-5 shrink-0', className)} />
)

type MainNavLinkProps = {
  item: MainNavItem
  pathname: string
  children?: ReactNode
  mode?: 'expand' | 'collapse'
}

const MainNavLink = ({ item, pathname, children, mode = 'expand' }: MainNavLinkProps) => {
  const activated = item.active(pathname)
  const isCollapsed = mode === 'collapse'

  return (
    <Link
      href={item.href}
      aria-current={activated ? 'page' : undefined}
      title={item.label}
      className={cn(
        'group relative flex h-8 w-full items-center gap-2 rounded-[10px] px-2 py-1.5 outline-hidden transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
        'not-aria-[current=page]:bg-components-main-nav-nav-button-bg not-aria-[current=page]:system-md-medium not-aria-[current=page]:text-components-main-nav-nav-button-text not-aria-[current=page]:hover:bg-components-main-nav-nav-button-bg-hover not-aria-[current=page]:hover:text-components-main-nav-nav-button-text',
        'aria-[current=page]:dify-blue-glass-surface aria-[current=page]:z-1',
        isCollapsed && 'size-8 justify-center px-0',
      )}
    >
      <NavIcon icon={item.icon} className="group-aria-[current=page]:hidden" />
      <NavIcon icon={item.activeIcon} className="hidden group-aria-[current=page]:block" />
      <span
        className={cn(
          'min-w-0 truncate whitespace-nowrap transition-[margin-left,max-width,opacity] duration-200 ease-in-out group-aria-[current=page]:text-shadow-[0px_0px_8px_var(--color-components-main-nav-glass-text-glow)]',
          isCollapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-0 max-w-none opacity-100',
        )}
      >
        {item.label}
      </span>
      {children}
    </Link>
  )
}

export default MainNavLink
