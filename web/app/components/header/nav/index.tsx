'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import type { INavSelectorProps } from './nav-selector'
import NavSelector from './nav-selector'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'

type INavProps = {
  icon: React.ReactNode
  activeIcon?: React.ReactNode
  text: string
  activeSegment: string | string[]
  link: string
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
}: INavProps) => {
  const [hovered, setHovered] = useState(false)
  const segment = useSelectedLayoutSegment()
  const isActived = Array.isArray(activeSegment) ? activeSegment.includes(segment!) : segment === activeSegment

  return (
    <div className={`
      flex items-center h-8 mr-3 px-0.5 rounded-xl text-sm shrink-0 font-medium
      ${isActived && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)] font-semibold'}
      ${!curNav && !isActived && 'hover:bg-gray-200'}
    `}>
      <Link href={link}>
        <div
          className={classNames(`
            flex items-center h-7 px-2.5 cursor-pointer rounded-[10px]
            ${isActived ? 'text-primary-600' : 'text-gray-500'}
            ${curNav && isActived && 'hover:bg-primary-50'}
          `)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className='mr-2'>
            {
              (hovered && curNav)
                ? <ArrowNarrowLeft className='w-4 h-4' />
                : isActived
                  ? activeIcon
                  : icon
            }
          </div>
          {text}
        </div>
      </Link>
      {
        curNav && isActived && (
          <>
            <div className='font-light text-gray-300 '>/</div>
            <NavSelector
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
