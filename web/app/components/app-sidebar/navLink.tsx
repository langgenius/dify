'use client'

import { useSelectedLayoutSegment } from 'next/navigation'
import Link from 'next/link'
import classNames from '@/utils/classnames'
import type { RemixiconComponentType } from '@remixicon/react'

export type NavIcon = React.ComponentType<
  React.PropsWithoutRef<React.ComponentProps<'svg'>> & {
    title?: string | undefined
    titleId?: string | undefined
  }> | RemixiconComponentType

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

export default function NavLink({
  name,
  href,
  iconMap,
  mode = 'expand',
  disabled = false,
}: NavLinkProps) {
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

  if (disabled) {
    return (
      <button
        key={name}
        type='button'
        disabled
        className={classNames(
          'opacity-30 text-components-menu-item-text hover:bg-state-base-hover group flex items-center h-9 rounded-md py-2 system-sm-medium cursor-not-allowed',
          mode === 'expand' ? 'px-3' : 'px-2.5',
        )}
        title={mode === 'collapse' ? name : ''}
        aria-disabled
      >
        <NavIcon
          className={classNames(
            'h-4 w-4 flex-shrink-0',
            mode === 'expand' ? 'mr-2' : 'mr-0',
          )}
          aria-hidden="true"
        />
        {mode === 'expand' && name}
      </button>
    )
  }

  return (
    <Link
      key={name}
      href={href}
      className={classNames(
        isActive ? 'bg-state-accent-active text-text-accent font-semibold' : 'text-components-menu-item-text hover:bg-state-base-hover hover:text-components-menu-item-text-hover',
        'group flex items-center h-9 rounded-md py-2 system-sm-medium',
        mode === 'expand' ? 'px-3' : 'px-2.5',
      )}
      title={mode === 'collapse' ? name : ''}
    >
      <NavIcon
        className={classNames(
          'h-4 w-4 flex-shrink-0',
          mode === 'expand' ? 'mr-2' : 'mr-0',
        )}
        aria-hidden="true"
      />
      {mode === 'expand' && name}
    </Link>
  )
}
