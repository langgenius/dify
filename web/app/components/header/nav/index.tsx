'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import type { INavSelectorProps } from './nav-selector'
import NavSelector from './nav-selector'
import classNames from '@/utils/classnames'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import { useStore as useAppStore } from '@/app/components/app/store'

type INavProps = {
  icon: React.ReactNode
  activeIcon?: React.ReactNode
  text: string
  activeSegment: string | string[]
  link: string
  isApp: boolean
} & INavSelectorProps

const Nav = ({
  icon,
  activeIcon,
  text,
  activeSegment,
  link,
  curNav,
  navs,
  createText,
  onCreate,
  onLoadmore,
  isApp,
}: INavProps) => {
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [hovered, setHovered] = useState(false)
  const segment = useSelectedLayoutSegment()
  const isActivated = Array.isArray(activeSegment) ? activeSegment.includes(segment!) : segment === activeSegment

  return (
    <div className={`
      mr-0 flex h-8 shrink-0 items-center rounded-xl px-0.5 text-sm font-medium sm:mr-3
      ${isActivated && 'bg-components-main-nav-nav-button-bg-active font-semibold shadow-md'}
      ${!curNav && !isActivated && 'hover:bg-components-main-nav-nav-button-bg-hover'}
    `}>
      <Link href={link}>
        <div
          onClick={() => setAppDetail()}
          className={classNames(`
            flex items-center h-7 px-2.5 cursor-pointer rounded-[10px]
            ${isActivated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text'}
            ${curNav && isActivated && 'hover:bg-components-main-nav-nav-button-bg-active-hover'}
          `)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className='mr-2'>
            {
              (hovered && curNav)
                ? <ArrowNarrowLeft className='h-4 w-4' />
                : isActivated
                  ? activeIcon
                  : icon
            }
          </div>
          {text}
        </div>
      </Link>
      {
        curNav && isActivated && (
          <>
            <div className='text-divider-deep font-light'>/</div>
            <NavSelector
              isApp={isApp}
              curNav={curNav}
              navs={navs}
              createText={createText}
              onCreate={onCreate}
              onLoadmore={onLoadmore}
            />
          </>
        )
      }
    </div>
  )
}

export default Nav
