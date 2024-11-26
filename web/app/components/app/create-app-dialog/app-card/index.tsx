'use client'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import { AppTypeIcon } from '../../type-selector'
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
    <div className={cn('p-4 h-[132px] relative overflow-hidden flex flex-col group bg-components-panel-on-panel-item-bg border-[0.5px] border-components-panel-border rounded-xl shadow-xs  hover:shadow-lg cursor-pointer')}>
      <div className='flex items-center gap-3 pb-2 grow-0 shrink-0'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={app.app.icon_type}
            icon={app.app.icon}
            background={app.app.icon_background}
            imageUrl={app.app.icon_url}
          />
          <AppTypeIcon wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4' className='w-3 h-3' mode={appBasicInfo.mode} />
        </div>
        <div className='grow flex flex-col gap-1'>
          <div className='line-clamp-1'>
            <span className='system-md-semibold text-text-secondary' title={appBasicInfo.name}>{appBasicInfo.name}</span>
          </div>
          <div className='system-2xs-medium-uppercase text-text-tertiary'>
            {appBasicInfo.mode === 'advanced-chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
            {appBasicInfo.mode === 'chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
            {appBasicInfo.mode === 'agent-chat' && <div className='truncate'>{t('app.types.agent').toUpperCase()}</div>}
            {appBasicInfo.mode === 'workflow' && <div className='truncate'>{t('app.types.workflow').toUpperCase()}</div>}
            {appBasicInfo.mode === 'completion' && <div className='truncate'>{t('app.types.completion').toUpperCase()}</div>}
          </div>
        </div>
      </div>
      <div className="py-1 system-xs-regular text-text-tertiary">
        <div className='line-clamp-3'>
          {app.description}
        </div>
      </div>
      <div className={cn('hidden absolute bottom-0 left-0 right-0 p-4 pt-8 group-hover:flex bg-gradient-to-t from-[60.27%] from-components-panel-gradient-2 to-transparent')}>
        <div className={cn('flex items-center w-full space-x-2 h-8')}>
          <Button variant='primary' className='grow' onClick={() => onCreate()}>
            <PlusIcon className='w-4 h-4 mr-1' />
            <span className='text-xs'>{t('app.newApp.useTemplate')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AppCard
