'use client'

import type { MainNavItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

const navItemClassName = 'group relative flex h-9 items-center gap-2 rounded-xl p-2 transition-colors'

const activeNavItemClassName = cn(
  'overflow-hidden border border-transparent',
  'bg-[linear-gradient(98.077deg,var(--color-components-main-nav-glass-surface-first)_0%,var(--color-components-main-nav-glass-surface-middle-1)_17.98%,var(--color-components-main-nav-glass-surface-middle-2)_58.75%,var(--color-components-main-nav-glass-surface-end)_101.09%)]',
  'system-md-semibold text-components-main-nav-text-active backdrop-blur-[5px]',
  'shadow-[0px_4px_8px_0px_var(--color-components-main-nav-glass-shadow-reflection-glow),0px_12px_16px_-4px_var(--color-shadow-shadow-5),0px_4px_6px_-2px_var(--color-shadow-shadow-1),0px_10px_16px_-4px_var(--color-components-main-nav-glass-shadow-reflection)]',
  'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:p-px',
  'before:bg-[linear-gradient(var(--color-components-main-nav-glass-edge-highlight-first),var(--color-components-main-nav-glass-edge-highlight-first))_top/100%_1px_no-repeat,linear-gradient(var(--color-components-main-nav-glass-edge-highlight-end),var(--color-components-main-nav-glass-edge-highlight-end))_bottom/100%_1px_no-repeat,linear-gradient(180deg,var(--color-components-main-nav-glass-edge-reflection-first)_0%,var(--color-components-main-nav-glass-edge-reflection-middle)_50%,var(--color-components-main-nav-glass-edge-reflection-end)_100%)_left/1px_100%_no-repeat,linear-gradient(180deg,var(--color-components-main-nav-glass-edge-reflection-first)_0%,var(--color-components-main-nav-glass-edge-reflection-middle)_50%,var(--color-components-main-nav-glass-edge-reflection-end)_100%)_right/1px_100%_no-repeat]',
  'before:[mask-composite:exclude] before:[content:""] before:[-webkit-mask-composite:xor] before:[-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]',
  'after:pointer-events-none after:absolute after:inset-[-1px] after:rounded-[inherit] after:border after:border-components-main-nav-glass-edge-highlight-first after:shadow-[inset_0_0_8px_0_var(--color-components-main-nav-glass-inner-glow)] after:[content:""]',
)

const inactiveNavItemClassName = 'system-md-medium bg-components-main-nav-nav-button-bg text-components-main-nav-text hover:bg-state-base-hover hover:text-components-main-nav-text'

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
