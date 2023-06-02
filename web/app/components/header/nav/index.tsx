'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import type { INavSelectorProps } from './nav-selector'
import NavSelector from './nav-selector'

type INavProps = {
  icon: React.ReactNode
  text: string
  activeSegment: string | string[]
  link: string
} & INavSelectorProps

const Nav = ({
  icon,
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
      flex items-center h-8 mr-3 px-0.5  rounded-xl text-[14px] shrink-0
      ${isActived && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]'}
    `}>
      <Link href={link}>
        <div
          className={classNames(`
            flex items-center h-7 pl-2.5 pr-2
            font-semibold cursor-pointer rounded-[10px]
            ${isActived ? 'text-[#1C64F2]' : 'text-gray-500 hover:bg-gray-200'}
            ${curNav && isActived && 'hover:bg-[#EBF5FF]'}
          `)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {
            (hovered && curNav && isActived)
              ? <ArrowLeftIcon className='mr-1 w-[18px] h-[18px]' />
              : icon
          }
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
