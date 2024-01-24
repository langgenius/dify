'use client'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/20/solid'
import Button from '../../base/button'
import s from './style.module.css'
import type { App } from '@/models/explore'
import AppModeLabel from '@/app/(commonLayout)/apps/AppModeLabel'
import AppIcon from '@/app/components/base/app-icon'

export type AppCardProps = {
  app: App
  canCreate: boolean
  onCreate: () => void
}

const AppCard = ({
  app,
  canCreate,
  onCreate,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { app: appBasicInfo, is_agent } = app
  return (
    <div className={cn(s.wrap, 'col-span-1 bg-white border-2 border-solid border-transparent rounded-lg shadow-sm min-h-[160px] flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg')}>
      <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
        <AppIcon size='small' icon={app.app.icon} background={app.app.icon_background} />
        <div className='relative h-8 text-sm font-medium leading-8 grow'>
          <div className='absolute top-0 left-0 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap'>{appBasicInfo.name}</div>
        </div>
      </div>
      <div className='mb-3 px-[14px] h-9 text-xs leading-normal text-gray-500 line-clamp-2'>{app.description}</div>
      <div className='flex items-center flex-wrap min-h-[42px] px-[14px] pt-2 pb-[10px]'>
        <div className={s.mode}>
          <AppModeLabel mode={appBasicInfo.mode} isAgent={is_agent} />
        </div>
        {
          canCreate && (
            <div className={cn(s.opWrap, 'flex items-center w-full space-x-2')}>
              <Button type='primary' className='grow flex items-center !h-7' onClick={() => onCreate()}>
                <PlusIcon className='w-4 h-4 mr-1' />
                <span className='text-xs'>{t('explore.appCard.addToWorkspace')}</span>
              </Button>
            </div>
          )
        }
      </div>
    </div>
  )
}

export default AppCard
