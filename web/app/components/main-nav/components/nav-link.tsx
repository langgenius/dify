'use client'

import type { MainNavItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

const navItemClassName = 'group relative flex h-8 w-full items-center gap-2 rounded-[10px] px-2 py-1.5 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-state-accent-solid'

const activeNavItemClassName = cn(
  'main-nav-active-glass',
  'z-1',
)

const inactiveNavItemClassName = 'system-md-medium bg-components-main-nav-nav-button-bg text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover hover:text-components-main-nav-nav-button-text'

const NavIcon = ({
  icon,
  className,
}: {
  icon: string
  className?: string
}) => (
  <span aria-hidden className={cn(icon, 'h-5 w-5 shrink-0', className)} />
)

type MainNavLinkProps = {
  item: MainNavItem
  pathname: string
}

const MainNavLink = ({
  item,
  pathname,
}: MainNavLinkProps) => {
  const activated = item.active(pathname)

  return (
    <Link
      href={item.href}
      aria-current={activated ? 'page' : undefined}
      title={item.label}
      className={cn(
        navItemClassName,
        activated ? activeNavItemClassName : inactiveNavItemClassName,
      )}
    >
      <NavIcon icon={activated ? item.activeIcon : item.icon} />
      <span className={cn('truncate', activated && 'text-shadow-[0px_0px_8px_var(--color-components-main-nav-glass-text-glow)]')}>{item.label}</span>
    </Link>
  )
}

export default MainNavLink
