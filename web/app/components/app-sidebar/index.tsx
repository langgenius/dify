import React from 'react'
import type { FC } from 'react'
import NavLink from './navLink'
import AppBasic from './basic'

export type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset'
  title: string
  desc: string
  navigation: Array<{
    name: string
    href: string
    icon: any
    selectedIcon: any
  }>
  extraInfo?: React.ReactNode
}

const sampleAppIconUrl = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80'

const AppDetailNav: FC<IAppDetailNavProps> = ({ title, desc, navigation, extraInfo, iconType = 'app' }) => {
  return (
    <div className="flex flex-col w-56 overflow-y-auto bg-white border-r border-gray-200 shrink-0">
      <div className="flex flex-shrink-0 p-4">
        <AppBasic iconType={iconType} iconUrl={sampleAppIconUrl} name={title} type={desc} />
      </div>
      <nav className="flex-1 p-4 space-y-1 bg-white">
        {navigation.map((item, index) => {
          return (
            <NavLink key={index} iconMap={{ selected: item.selectedIcon, normal: item.icon }} name={item.name} href={item.href} />
          )
        })}
        {extraInfo ?? null}
      </nav>
    </div>
  )
}

export default React.memo(AppDetailNav)
