import type { ShortcutPlatform } from './shortcut-platform'

export type MainNavProps = {
  className?: string
  initialPlatform?: ShortcutPlatform | null
}

export type MainNavItem = {
  href: string
  label: string
  active: (pathname: string) => boolean
  icon: string
  activeIcon: string
}
