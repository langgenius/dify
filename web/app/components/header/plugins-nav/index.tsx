'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import classNames from '@/utils/classnames'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { useSelectedLayoutSegment } from 'next/navigation'
import DownloadingIcon from './downloading-icon'
import { usePluginTaskStatus } from '@/app/components/plugins/plugin-page/plugin-tasks/hooks'
import Indicator from '@/app/components/header/indicator'

type PluginsNavProps = {
  className?: string
}

const PluginsNav = ({
  className,
}: PluginsNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const activated = selectedSegment === 'plugins'
  const {
    isInstalling,
    isInstallingWithError,
    isFailed,
  } = usePluginTaskStatus()

  return (
    <Link href="/plugins" className={classNames(
      className, 'group', 'plugins-nav-button', // used for use-fold-anim-into.ts
    )}>
      <div
        className={classNames(
          'relative flex flex-row h-8 p-1.5 gap-0.5 border border-transparent items-center justify-center rounded-xl system-sm-medium-uppercase',
          activated && 'border-components-main-nav-nav-button-border bg-components-main-nav-nav-button-bg-active shadow-md text-components-main-nav-nav-button-text',
          !activated && 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          (isInstallingWithError || isFailed) && !activated && 'border-components-panel-border-subtle',
        )}
      >
        {
          (isFailed || isInstallingWithError) && !activated && (
            <Indicator
              color='red'
              className='absolute left-[-1px] top-[-1px]'
            />
          )
        }
        <div className='mr-0.5 flex h-5 w-5 items-center justify-center'>
          {
            (!(isInstalling || isInstallingWithError) || activated) && (
              <Group className='h-4 w-4' />
            )
          }
          {
            (isInstalling || isInstallingWithError) && !activated && (
              <DownloadingIcon />
            )
          }
        </div>
        <span className='px-0.5'>{t('common.menus.plugins')}</span>
      </div>
    </Link>
  )
}

export default PluginsNav
