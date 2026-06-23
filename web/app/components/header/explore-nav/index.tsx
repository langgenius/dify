'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  RiPlanetFill,
  RiPlanetLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { usePathname, useSelectedLayoutSegment } from '@/next/navigation'

export function ExploreNav({
  className,
}: {
  className?: string
}) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const selectedSegment = useSelectedLayoutSegment()
  const activated = pathname === '/' || selectedSegment === 'explore'

  return (
    <Link
      href="/"
      className={cn(className, 'group', activated && 'bg-components-main-nav-nav-button-bg-active shadow-md', activated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover')}
    >
      {
        activated
          ? <RiPlanetFill className="size-4" />
          : <RiPlanetLine className="size-4" />
      }
      <div className="ml-2 max-[1120px]:hidden">
        {t('menus.explore', { ns: 'common' })}
      </div>
    </Link>
  )
}
