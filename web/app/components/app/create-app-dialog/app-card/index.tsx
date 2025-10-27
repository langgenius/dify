'use client'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import { AppTypeIcon, AppTypeLabel } from '../../type-selector'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import type { App } from '@/models/explore'
import AppIcon from '@/app/components/base/app-icon'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { RiInformation2Line } from '@remixicon/react'
import { useCallback } from 'react'
import AppListContext from '@/context/app-list-context'
import { useContextSelector } from 'use-context-selector'

export type AppCardProps = {
  app: App
  canCreate: boolean
  onCreate: () => void
}

const AppCard = ({
  app,
  onCreate,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { app: appBasicInfo } = app
  const { systemFeatures } = useGlobalPublicStore()
  const isTrialApp = app.can_trial && systemFeatures.enable_trial_app
  const setShowTryAppPanel = useContextSelector(AppListContext, ctx => ctx.setShowTryAppPanel)
  const showTryAPPPanel = useCallback((appId: string) => {
    return () => {
      setShowTryAppPanel?.(true, { appId, app })
    }
  }, [setShowTryAppPanel, app.category])
  return (
    <div className={cn('group relative flex h-[132px] cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4  shadow-xs hover:shadow-lg')}>
      <div className='flex shrink-0 grow-0 items-center gap-3 pb-2'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={appBasicInfo.icon_type}
            icon={appBasicInfo.icon}
            background={appBasicInfo.icon_background}
            imageUrl={appBasicInfo.icon_url}
          />
          <AppTypeIcon wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-[4px] border border-divider-regular outline outline-components-panel-on-panel-item-bg'
            className='h-3 w-3' type={appBasicInfo.mode} />
        </div>
        <div className='flex grow flex-col gap-1'>
          <div className='line-clamp-1'>
            <span className='system-md-semibold text-text-secondary' title={appBasicInfo.name}>{appBasicInfo.name}</span>
          </div>
          <AppTypeLabel className='system-2xs-medium-uppercase text-text-tertiary' type={app.app.mode} />
        </div>
      </div>
      <div className="system-xs-regular py-1 text-text-tertiary">
        <div className='line-clamp-3'>
          {app.description}
        </div>
      </div>
      <div className={cn('absolute bottom-0 left-0 right-0 hidden bg-gradient-to-t from-components-panel-gradient-2 from-[60.27%] to-transparent p-4 pt-8 group-hover:flex')}>
        <div className={cn('w-full', isTrialApp && 'grid grid-cols-2 gap-2')}>
          <Button variant='primary' className='w-full' onClick={() => onCreate()}>
            <PlusIcon className='mr-1 h-4 w-4' />
            <span className='text-xs'>{t('app.newApp.useTemplate')}</span>
          </Button>
          {isTrialApp && (
            <Button className='w-full' onClick={showTryAPPPanel(app.app_id)}>
              <RiInformation2Line className='mr-1 size-4' />
              <span>{t('explore.appCard.try')}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AppCard
