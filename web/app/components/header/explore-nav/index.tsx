'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import {
  RiPlanetFill,
  RiPlanetLine,
} from '@remixicon/react'
import classNames from '@/utils/classnames'
type ExploreNavProps = {
  className?: string
}

const ExploreNav = ({
  className,
}: ExploreNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const actived = selectedSegment === 'explore'

  return (
    <Link href="/explore/apps" className={classNames(
      className, 'group',
      actived && 'bg-components-main-nav-nav-button-bg-active shadow-md',
      actived ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover',
    )}>
      {
        actived
          ? <RiPlanetFill className='mr-2 w-4 h-4' />
          : <RiPlanetLine className='mr-2 w-4 h-4' />
      }
      {t('common.menus.explore')}
    </Link>
  )
}

export default ExploreNav
