'use client'

import { useSelectedLayoutSegment } from 'next/navigation'
import Link from 'next/link'
import classNames from '@/utils/classnames'

export type NavIcon = React.ComponentType<
React.PropsWithoutRef<React.ComponentProps<'svg'>> & {
  title?: string | undefined
  titleId?: string | undefined
}
>

export type NavLinkProps = {
  name: string
  href: string
  iconMap: {
    selected: NavIcon
    normal: NavIcon
  }
  mode?: string
}

export default function NavLink({
  name,
  href,
  iconMap,
  mode = 'expand',
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

  return (
    <Link
      key={name}
      href={href}
      className={classNames(
        isActive ? 'bg-state-accent-active text-text-accent font-semibold' : 'text-components-menu-item-text hover:bg-gray-100 hover:text-components-menu-item-text-hover',
        'group flex items-center h-9 rounded-md py-2 text-sm font-normal',
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
