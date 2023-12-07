import React from 'react'
import NavLink from './navLink'
import type { NavIcon } from './navLink'
import AppBasic from './basic'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

export type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset' | 'notion'
  title: string
  desc: string
  icon: string
  icon_background: string
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>
  extraInfo?: React.ReactNode
}

const AppDetailNav = ({ title, desc, icon, icon_background, navigation, extraInfo, iconType = 'app' }: IAppDetailNavProps) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const mode = isMobile ? 'collapse' : 'expand'

  return (
    <div className="flex flex-col sm:w-56 w-16 overflow-y-auto bg-white border-r border-gray-200 shrink-0 mobile:h-screen">
      <div className="flex flex-shrink-0 p-4">
        <AppBasic mode={mode} iconType={iconType} icon={icon} icon_background={icon_background} name={title} type={desc} />
      </div>
      <nav className="flex-1 p-4 space-y-1 bg-white">
        {navigation.map((item, index) => {
          return (
            <NavLink key={index} mode={mode} iconMap={{ selected: item.selectedIcon, normal: item.icon }} name={item.name} href={item.href} />
          )
        })}
        {extraInfo ?? null}
      </nav>
    </div>
  )
}

export default React.memo(AppDetailNav)
