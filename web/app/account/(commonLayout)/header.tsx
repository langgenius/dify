'use client'
import { Button } from '@langgenius/dify-ui/button'
import { RiArrowRightUpLine, RiRobot2Line } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { useRouter } from '@/next/navigation'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import Avatar from './avatar'

const Header = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

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
        <div className="h-4 w-px origin-center rotate-[11.31deg] bg-divider-regular" />
        <p className="relative mt-[-2px] title-3xl-semi-bold text-text-primary">{t('account.account', { ns: 'common' })}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button className="gap-2 px-3 py-2 system-sm-medium" onClick={goToStudio}>
          <RiRobot2Line className="h-4 w-4" />
          <p>{t('account.studio', { ns: 'common' })}</p>
          <RiArrowRightUpLine className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-divider-regular" />
        <Avatar />
      </div>
    </div>
  )
}
export default Header
