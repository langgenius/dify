import type { ShortcutPlatform } from '@/utils/platform'

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
