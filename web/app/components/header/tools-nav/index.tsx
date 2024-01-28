'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { Tools, ToolsActive } from '../../base/icons/src/public/header-nav/tools'
type ToolsNavProps = {
  className?: string
}

const ToolsNav = ({
  className,
}: ToolsNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const actived = selectedSegment === 'tools'

  return (
    <Link href="/tools" className={classNames(
      className, 'group',
      actived && 'bg-white shadow-md',
      actived ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
    )}>
      {
        actived
          ? <ToolsActive className='mr-2 w-4 h-4' />
          : <Tools className='mr-2 w-4 h-4' />
      }
      {t('common.menus.tools')}
    </Link>
  )
}

export default ToolsNav
