'use client'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import Button from '../../base/button'
import cn from '@/utils/classnames'
import type { App } from '@/models/explore'
import AppIcon from '@/app/components/base/app-icon'
import { AppTypeIcon } from '../../app/type-selector'
export type AppCardProps = {
  app: App
  canCreate: boolean
  onCreate: () => void
  isExplore: boolean
}

const AppCard = ({
  app,
  canCreate,
  onCreate,
  isExplore,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { app: appBasicInfo } = app
  return (
    <div className={cn('group relative col-span-1 flex cursor-pointer flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-2 shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg')}>
      <div className='flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pb-3 pt-[14px]'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={appBasicInfo.icon_type}
            icon={appBasicInfo.icon}
            background={appBasicInfo.icon_background}
            imageUrl={appBasicInfo.icon_url}
          />
          <AppTypeIcon wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm'
            className='h-3 w-3' type={appBasicInfo.mode} />
        </div>
        <div className='w-0 grow py-[1px]'>
          <div className='flex items-center text-sm font-semibold leading-5 text-text-secondary'>
            <div className='truncate' title={appBasicInfo.name}>{appBasicInfo.name}</div>
          </div>
          <div className='flex items-center text-[10px] font-medium leading-[18px] text-text-tertiary'>
            {appBasicInfo.mode === 'advanced-chat' && <div className='truncate'>{t('app.types.advanced').toUpperCase()}</div>}
            {appBasicInfo.mode === 'chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
            {appBasicInfo.mode === 'agent-chat' && <div className='truncate'>{t('app.types.agent').toUpperCase()}</div>}
            {appBasicInfo.mode === 'workflow' && <div className='truncate'>{t('app.types.workflow').toUpperCase()}</div>}
            {appBasicInfo.mode === 'completion' && <div className='truncate'>{t('app.types.completion').toUpperCase()}</div>}
          </div>
        </div>
      </div>
      <div className="description-wrapper system-xs-regular h-[90px] px-[14px] text-text-tertiary">
        <div className='line-clamp-4 group-hover:line-clamp-2'>
          {app.description}
        </div>
      </div>
      {isExplore && canCreate && (
        <div className={cn('absolute bottom-0 left-0 right-0 hidden bg-gradient-to-t from-components-panel-gradient-2 from-[60.27%] to-transparent p-4 pt-8 group-hover:flex')}>
          <div className={cn('flex h-8 w-full items-center space-x-2')}>
            <Button variant='primary' className='h-7 grow' onClick={() => onCreate()}>
              <PlusIcon className='mr-1 h-4 w-4' />
              <span className='text-xs'>{t('explore.appCard.addToWorkspace')}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppCard
