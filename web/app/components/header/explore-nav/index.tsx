'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { Grid01 } from '@/app/components/base/icons/src/vender/line/layout'
import { Grid01 as Grid01Solid } from '@/app/components/base/icons/src/vender/solid/layout'

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
      actived && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
      actived ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
    )}>
      {
        actived
          ? <Grid01Solid className='mr-2 w-4 h-4' />
          : <Grid01 className='mr-2 w-4 h-4' />
      }
      {t('common.menus.explore')}
    </Link>
  )
}

export default ExploreNav
