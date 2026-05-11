'use client'

import type { MainNavItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

const navItemClassName = 'group relative flex h-9 items-center gap-2 rounded-xl p-2 transition-colors'

const activeNavItemClassName = cn(
  'overflow-hidden',
  'bg-[linear-gradient(98.077deg,rgba(0,51,255,0.08)_0%,rgba(0,51,255,0.12)_17.98%,rgba(0,51,255,0.1)_58.75%,rgba(0,51,255,0.08)_101.09%)]',
  'system-md-semibold text-saas-dify-blue-inverted backdrop-blur-[5px]',
  'shadow-[0px_4px_8px_0px_rgba(255,255,255,0),0px_12px_16px_-4px_rgba(9,9,11,0.08),0px_4px_6px_-2px_rgba(9,9,11,0.03),0px_10px_16px_-4px_rgba(0,51,255,0.06)]',
  'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:p-px before:content-[\'\']',
  'before:bg-[linear-gradient(rgba(255,255,255,0.98),rgba(255,255,255,0.98))_top/100%_1px_no-repeat,linear-gradient(rgba(255,255,255,0.42),rgba(255,255,255,0.42))_bottom/100%_1px_no-repeat,linear-gradient(180deg,rgba(0,51,255,0)_0%,rgba(0,51,255,0.6)_50%,rgba(0,51,255,0)_100%)_left/1px_100%_no-repeat,linear-gradient(180deg,rgba(0,51,255,0)_0%,rgba(0,51,255,0.6)_50%,rgba(0,51,255,0)_100%)_right/1px_100%_no-repeat]',
  'before:[mask-composite:exclude] before:[-webkit-mask-composite:xor] before:[-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]',
  'after:pointer-events-none after:absolute after:inset-[-1px] after:rounded-[inherit] after:border after:border-[rgba(255,255,255,0.98)] after:shadow-[inset_0_0_8px_0_rgba(255,255,255,0.3)] after:content-[\'\']',
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
      title={item.label}
      className={cn(
        navItemClassName,
        activated ? activeNavItemClassName : inactiveNavItemClassName,
      )}
    >
      <NavIcon icon={activated ? item.activeIcon : item.icon} />
      <span className={cn('truncate', activated && 'text-shadow-[0px_0px_8px_rgba(49,70,255,0.18)]')}>{item.label}</span>
    </Link>
  )
}

export default MainNavLink
