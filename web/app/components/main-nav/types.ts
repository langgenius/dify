export type MainNavProps = {
  className?: string
}

export type MainNavItem = {
  href: string
  label: string
  active: (pathname: string) => boolean
  icon: string
  activeIcon: string
}
