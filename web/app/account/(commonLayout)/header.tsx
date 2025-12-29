'use client'
import { RiArrowRightUpLine, RiRobot2Line } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { useGlobalPublicStore } from '@/context/global-public-context'
import Avatar from './avatar'

const Header = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  const goToStudio = useCallback(() => {
    router.push('/apps')
  }, [router])

  return (
    <div className="flex flex-1 items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <div className="flex cursor-pointer items-center" onClick={goToStudio}>
          {systemFeatures.branding.enabled && systemFeatures.branding.login_page_logo
            ? (
                <img
                  src={systemFeatures.branding.login_page_logo}
                  className="block h-[22px] w-auto object-contain"
                  alt="Dify logo"
                />
              )
            : <DifyLogo />}
        </div>
        <div className="h-4 w-[1px] origin-center rotate-[11.31deg] bg-divider-regular" />
        <p className="title-3xl-semi-bold relative mt-[-2px] text-text-primary">{t('account.account', { ns: 'common' })}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button className="system-sm-medium gap-2 px-3 py-2" onClick={goToStudio}>
          <RiRobot2Line className="h-4 w-4" />
          <p>{t('account.studio', { ns: 'common' })}</p>
          <RiArrowRightUpLine className="h-4 w-4" />
        </Button>
        <div className="h-4 w-[1px] bg-divider-regular" />
        <Avatar />
      </div>
    </div>
  )
}
export default Header
