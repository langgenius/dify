'use client'

import type { INavSelectorProps } from './nav-selector'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useState } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'
import { NavSelector } from './nav-selector'

type INavProps = {
  icon: React.ReactNode
  activeIcon?: React.ReactNode
  text: string
  activeSegment: string | string[]
  link: string
  activeLink?: {
    segment: string
    text: string
    link: string
  }
  isApp: boolean
} & INavSelectorProps

const Nav = ({
  icon,
  activeIcon,
  text,
  activeSegment,
  link,
  activeLink,
  curNav,
  navigationItems,
  createText,
  onCreate,
  onLoadMore,
  isLoadingMore,
  isApp,
}: INavProps) => {
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [hovered, setHovered] = useState(false)
  const segment = useSelectedLayoutSegment()
  const isActivated = Array.isArray(activeSegment) ? activeSegment.includes(segment!) : segment === activeSegment
  const shouldShowActiveLink = isActivated && activeLink && segment === activeLink.segment

  return (
    <div className={`
      flex h-8 max-w-167.5 min-w-0 items-center rounded-xl px-0.5 text-sm font-medium max-[1120px]:max-w-100
      ${isActivated && 'bg-components-main-nav-nav-button-bg-active font-semibold shadow-md'}
      ${!curNav && !isActivated && 'hover:bg-components-main-nav-nav-button-bg-hover'}
    `}
    >
      <Link href={link} className="shrink-0">
        <div
          onClick={(e) => {
            // Don't clear state if opening in new tab/window
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
              return
            if (segment === 'snippets')
              return
            setAppDetail()
          }}
          className={cn('flex h-7 cursor-pointer items-center rounded-[10px] px-2.5', isActivated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text', curNav && isActivated && 'hover:bg-components-main-nav-nav-button-bg-active-hover')}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div>
            {
              (hovered && curNav)
                ? <span className="i-custom-vender-line-arrows-arrow-narrow-left size-4" />
                : isActivated
                  ? activeIcon
                  : icon
            }
          </div>
          <div className="ml-2 max-[1120px]:hidden">
            {text}
          </div>
        </div>
      </Link>
      {
        curNav && isActivated && (
          <>
            <div className="shrink-0 font-light text-divider-deep">/</div>
            <NavSelector
              isApp={isApp}
              curNav={curNav}
              navigationItems={navigationItems}
              createText={createText}
              onCreate={onCreate}
              onLoadMore={onLoadMore}
              isLoadingMore={isLoadingMore}
            />
          </>
        )
      }
      {
        !curNav && shouldShowActiveLink && (
          <>
            <div className="shrink-0 font-light text-divider-deep">/</div>
            <Link
              href={activeLink.link}
              className="hover:bg-components-main-nav-nav-button-bg-active-hover flex h-7 min-w-0 cursor-pointer items-center rounded-[10px] px-2.5 text-components-main-nav-nav-button-text-active"
            >
              <span className="truncate">{activeLink.text}</span>
            </Link>
          </>
        )
      }
    </div>
  )
}

export default Nav
