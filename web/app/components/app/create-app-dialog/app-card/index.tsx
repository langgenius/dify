'use client'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import { AppTypeIcon, AppTypeLabel } from '../../type-selector'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import type { App } from '@/models/explore'
import AppIcon from '@/app/components/base/app-icon'

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
        <div className={cn('flex h-8 w-full items-center space-x-2')}>
          <Button variant='primary' className='grow' onClick={() => onCreate()}>
            <PlusIcon className='mr-1 h-4 w-4' />
            <span className='text-xs'>{t('app.newApp.useTemplate')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AppCard
