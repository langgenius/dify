'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Group } from '@/app/components/base/icons/src/vender/other'
import Indicator from '@/app/components/header/indicator'
import { usePluginTaskStatus } from '@/app/components/plugins/plugin-page/plugin-tasks/hooks'
import { cn } from '@/utils/classnames'
import DownloadingIcon from './downloading-icon'

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
    <Link
      href="/plugins"
      className={cn(className, 'group', 'plugins-nav-button',
      // used for use-fold-anim-into.ts
      )}
    >
      <div
        className={cn('system-sm-medium relative flex h-8 flex-row items-center justify-center gap-0.5 rounded-xl border border-transparent p-1.5', activated && 'border-components-main-nav-nav-button-border bg-components-main-nav-nav-button-bg-active text-components-main-nav-nav-button-text shadow-md', !activated && 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', (isInstallingWithError || isFailed) && !activated && 'border-components-panel-border-subtle')}
      >
        {
          (isFailed || isInstallingWithError) && !activated && (
            <Indicator
              color="red"
              className="absolute left-[-1px] top-[-1px]"
            />
          )
        }
        <div className="mr-0.5 flex h-5 w-5 items-center justify-center">
          {
            (!(isInstalling || isInstallingWithError) || activated) && (
              <Group className="h-4 w-4" />
            )
          }
          {
            (isInstalling || isInstallingWithError) && !activated && (
              <DownloadingIcon />
            )
          }
        </div>
        <span className="px-0.5">{t('menus.plugins', { ns: 'common' })}</span>
      </div>
    </Link>
  )
}

export default PluginsNav
