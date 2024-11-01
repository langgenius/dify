'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import classNames from '@/utils/classnames'
import { Group } from '@/app/components/base/icons/src/vender/other'
type PluginsNavProps = {
  className?: string
}

const PluginsNav = ({
  className,
}: PluginsNavProps) => {
  const { t } = useTranslation()

  return (
    <Link href="/plugins" className={classNames(
      className, 'group',
    )}>
      <div className='flex flex-row p-1.5 gap-0.5 items-center justify-center rounded-xl system-xs-medium-uppercase hover:bg-state-base-hover text-text-tertiary hover:text-text-secondary'>
        <div className='flex w-4 h-4 justify-center items-center'>
          <Group />
        </div>
        <span className='px-0.5'>{t('common.menus.plugins')}</span>
      </div>
    </Link>
  )
}

export default PluginsNav
