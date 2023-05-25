'use client'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { App } from '@/models/explore'
import AppModeLabel from '@/app/(commonLayout)/apps/AppModeLabel'
import AppIcon from '@/app/components/base/app-icon'
import { PlusIcon } from '@heroicons/react/20/solid'
import Button from '../../base/button'

import s from './style.module.css'

const CustomizeBtn = (
  <svg width="15" height="14" viewBox="0 0 15 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.5 2.33366C6.69458 2.33366 6.04167 2.98658 6.04167 3.79199C6.04167 4.59741 6.69458 5.25033 7.5 5.25033C8.30542 5.25033 8.95833 4.59741 8.95833 3.79199C8.95833 2.98658 8.30542 2.33366 7.5 2.33366ZM7.5 2.33366V1.16699M12.75 8.71385C11.4673 10.1671 9.59071 11.0837 7.5 11.0837C5.40929 11.0837 3.53265 10.1671 2.25 8.71385M6.76782 5.05298L2.25 12.8337M8.23218 5.05298L12.75 12.8337" stroke="#344054" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
)

export type AppCardProps = {
  app: App,
  canCreate: boolean,
  onCreate: () => void,
  onAddToWorkspace: (appId: string) => void,
}

const AppCard = ({
  app,
  canCreate,
  onCreate,
  onAddToWorkspace,
}: AppCardProps) => {
  const { t } = useTranslation()
  const {app: appBasicInfo} = app
  return (
    <div className={s.wrap}>
      <div className='col-span-1 bg-white border-2 border-solid border-transparent rounded-lg shadow-sm min-h-[160px] flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg'>
        <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
          <AppIcon size='small' icon={app.app.icon} background={app.app.icon_background} />
          <div className='relative h-8 text-sm font-medium leading-8 grow'>
            <div className='absolute top-0 left-0 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap'>{appBasicInfo.name}</div>
          </div>
        </div>
        <div className='mb-3 px-[14px] h-9 text-xs leading-normal text-gray-500 line-clamp-2'>{app.description}</div>
        <div className='flex items-center flex-wrap min-h-[42px] px-[14px] pt-2 pb-[10px]'>
          <div className={s.mode}>
            <AppModeLabel mode={appBasicInfo.mode} />
          </div>
          <div className={cn(s.opWrap, 'flex items-center w-full space-x-2')}>
            <Button type='primary' className='grow flex items-center !h-7' onClick={() => onAddToWorkspace(appBasicInfo.id)}>
              <PlusIcon className='w-4 h-4 mr-1' />
              <span className='text-xs'>{t('explore.appCard.addToWorkspace')}</span>
            </Button>
            {canCreate && (
              <Button className='grow flex items-center !h-7 space-x-1' onClick={onCreate}>
                {CustomizeBtn}
                <span className='text-xs'>{t('explore.appCard.customize')}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppCard
