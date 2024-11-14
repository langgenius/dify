'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import classNames from '@/utils/classnames'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { useSelectedLayoutSegment } from 'next/navigation'

type PluginsNavProps = {
  className?: string
}

const PluginsNav = ({
  className,
}: PluginsNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const activated = selectedSegment === 'plugins'

  return (
    <Link href="/plugins" className={classNames(
      className, 'group',
    )}>
      <div className={`flex flex-row h-8 p-1.5 gap-0.5 items-center justify-center 
        rounded-xl system-sm-medium-uppercase ${activated
      ? 'border border-components-main-nav-nav-button-border bg-components-main-nav-nav-button-bg-active shadow-md text-components-main-nav-nav-button-text'
      : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'}`}>
        <div className='flex w-4 h-4 justify-center items-center'>
          <Group />
        </div>
        <span className='px-0.5'>{t('common.menus.plugins')}</span>
      </div>
    </Link>
  )
}

export default PluginsNav
