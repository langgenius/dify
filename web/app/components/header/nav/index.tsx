'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams, useSelectedLayoutSegment } from 'next/navigation'
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
  navigationItems,
  createText,
  onCreate,
  onLoadMore,
  isApp,
}: INavProps) => {
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [hovered, setHovered] = useState(false)
  const segment = useSelectedLayoutSegment()
  const isActivated = Array.isArray(activeSegment) ? activeSegment.includes(segment!) : segment === activeSegment
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [linkLastSearchParams, setLinkLastSearchParams] = useState('')

  useEffect(() => {
    if (pathname === link)
      setLinkLastSearchParams(searchParams.toString())
  }, [pathname, searchParams])

  return (
    <div className={`
      flex h-8 max-w-[670px] shrink-0 items-center rounded-xl px-0.5 text-sm font-medium max-[1024px]:max-w-[400px]
      ${isActivated && 'bg-components-main-nav-nav-button-bg-active font-semibold shadow-md'}
      ${!curNav && !isActivated && 'hover:bg-components-main-nav-nav-button-bg-hover'}
    `}>
      <Link href={link + (linkLastSearchParams && `?${linkLastSearchParams}`)}>
        <div
          onClick={() => setAppDetail()}
          className={classNames(
            'flex h-7 cursor-pointer items-center rounded-[10px] px-2.5',
            isActivated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text',
            curNav && isActivated && 'hover:bg-components-main-nav-nav-button-bg-active-hover',
          )}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div>
            {
              (hovered && curNav)
                ? <ArrowNarrowLeft className='h-4 w-4' />
                : isActivated
                  ? activeIcon
                  : icon
            }
          </div>
          <div className='ml-2 max-[1024px]:hidden'>
            {text}
          </div>
        </div>
      </Link>
      {
        curNav && isActivated && (
          <>
            <div className='font-light text-divider-deep'>/</div>
            <NavSelector
              isApp={isApp}
              curNav={curNav}
              navigationItems={navigationItems}
              createText={createText}
              onCreate={onCreate}
              onLoadMore={onLoadMore}
            />
          </>
        )
      }
    </div>
  )
}

export default Nav
