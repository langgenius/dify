'use client'
import Link from 'next/link'
// import { useTranslation } from 'react-i18next'
// import s from './style.module.css'
import AppModeLabel from '@/app/(commonLayout)/apps/AppModeLabel'
import type { App } from '@/types/app'
import AppIcon from '@/app/components/base/app-icon'

export type AppCardProps = {
  app: App
}

const AppCard = ({
  app,
}: AppCardProps) => {

  return (
    <>
      <Link href={`/app/${app.id}/overview`} className='col-span-1 bg-white border-2 border-solid border-transparent rounded-lg shadow-sm min-h-[160px] flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg'>
        <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
          <AppIcon size='small' />
          <div className='relative h-8 text-sm font-medium leading-8 grow'>
            <div className='absolute top-0 left-0 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap'>{app.name}</div>
          </div>
        </div>
        <div className='mb-3 px-[14px] h-9 text-xs leading-normal text-gray-500 line-clamp-2'>{app.model_config?.pre_prompt}</div>
        <div className='flex items-center flex-wrap min-h-[42px] px-[14px] pt-2 pb-[10px]'>
          <AppModeLabel mode={app.mode} />
        </div>
      </Link>
    </>
  )
}

export default AppCard
