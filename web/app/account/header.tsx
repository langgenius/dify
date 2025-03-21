'use client'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiRobot2Line } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import Button from '../components/base/button'
import Avatar from './avatar'
import LogoSite from '@/app/components/base/logo/logo-site'

const Header = () => {
  const { t } = useTranslation()
  const router = useRouter()

  const back = () => {
    router.back()
  }
  return (
    <div className='flex flex-1 items-center justify-between px-4'>
      <div className='flex items-center gap-3'>
        <div className='flex cursor-pointer items-center' onClick={back}>
          <LogoSite className='object-contain' />
        </div>
        <div className='h-4 w-[1px] bg-divider-regular' />
        <p className='title-3xl-semi-bold text-text-primary'>{t('common.account.account')}</p>
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        <Button className='system-sm-medium gap-2 px-3 py-2' onClick={back}>
          <RiRobot2Line className='h-4 w-4' />
          <p>{t('common.account.studio')}</p>
          <RiArrowRightUpLine className='h-4 w-4' />
        </Button>
        <div className='h-4 w-[1px] bg-divider-regular' />
        <Avatar />
      </div>
    </div>
  )
}
export default Header
