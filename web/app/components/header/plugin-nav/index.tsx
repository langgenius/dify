'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { PuzzlePiece01 } from '@/app/components/base/icons/src/vender/line/development'
import { PuzzlePiece01 as PuzzlePiece01Solid } from '@/app/components/base/icons/src/vender/solid/development'

type PluginNavProps = {
  className?: string
}

const PluginNav = ({
  className,
}: PluginNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const isPluginsComingSoon = selectedSegment === 'plugins-coming-soon'

  return (
    <Link href="/plugins-coming-soon" className={classNames(
      className, 'group',
      isPluginsComingSoon && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
      isPluginsComingSoon ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
    )}>
      {
        isPluginsComingSoon
          ? <PuzzlePiece01Solid className='mr-2 w-4 h-4' />
          : <PuzzlePiece01 className='mr-2 w-4 h-4' />
      }
      {t('common.menus.plugins')}
    </Link>
  )
}

export default PluginNav
