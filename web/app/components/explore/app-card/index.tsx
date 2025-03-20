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
    <div className={cn('relative overflow-hidden pb-2 group col-span-1 bg-components-panel-on-panel-item-bg border-[0.5px] border-components-panel-border rounded-lg shadow-sm flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg')}>
      <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={appBasicInfo.icon_type}
            icon={appBasicInfo.icon}
            background={appBasicInfo.icon_background}
            imageUrl={appBasicInfo.icon_url}
          />
          <AppTypeIcon wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-[4px] border border-divider-regular outline outline-components-panel-on-panel-item-bg'
            className='w-3 h-3' type={appBasicInfo.mode} />
        </div>
        <div className='grow w-0 py-[1px]'>
          <div className='flex items-center text-sm leading-5 font-semibold text-text-secondary'>
            <div className='truncate' title={appBasicInfo.name}>{appBasicInfo.name}</div>
          </div>
          <div className='flex items-center text-[10px] leading-[18px] text-text-tertiary font-medium'>
            {appBasicInfo.mode === 'advanced-chat' && <div className='truncate'>{t('app.types.advanced').toUpperCase()}</div>}
            {appBasicInfo.mode === 'chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
            {appBasicInfo.mode === 'agent-chat' && <div className='truncate'>{t('app.types.agent').toUpperCase()}</div>}
            {appBasicInfo.mode === 'workflow' && <div className='truncate'>{t('app.types.workflow').toUpperCase()}</div>}
            {appBasicInfo.mode === 'completion' && <div className='truncate'>{t('app.types.completion').toUpperCase()}</div>}
          </div>
        </div>
      </div>
      <div className="description-wrapper h-[90px] px-[14px] system-xs-regular text-text-tertiary">
        <div className='line-clamp-4 group-hover:line-clamp-2'>
          {app.description}
        </div>
      </div>
      {isExplore && canCreate && (
        <div className={cn('hidden absolute bottom-0 left-0 right-0 p-4 pt-8 group-hover:flex bg-gradient-to-t from-[60.27%] from-components-panel-gradient-2 to-transparent')}>
          <div className={cn('flex items-center w-full space-x-2 h-8')}>
            <Button variant='primary' className='grow h-7' onClick={() => onCreate()}>
              <PlusIcon className='w-4 h-4 mr-1' />
              <span className='text-xs'>{t('explore.appCard.addToWorkspace')}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppCard
