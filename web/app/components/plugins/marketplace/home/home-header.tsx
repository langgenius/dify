'use client'

import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { CreatorCenter } from '@/app/components/plugins/plugin-page/nav-operations'
import Link from '@/next/link'
import { cn } from '@/utils/classnames'

type HomeHeaderProps = {
  actions?: React.ReactNode
  isMarketplacePlatform: boolean
}

const HomeHeader = ({
  actions,
  isMarketplacePlatform,
}: HomeHeaderProps) => {
  const { t } = useTranslation()

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center justify-between bg-background-default px-4 backdrop-blur-sm md:px-9',
        isMarketplacePlatform ? 'h-[46px]' : 'h-11',
      )}
    >
      <Link href="/" className="flex h-full w-[142px] items-center">
        <DifyLogo size="small" className="h-[18px] w-[39px] shrink-0" />
        <span className="ml-1 whitespace-nowrap text-[13px] font-semibold leading-[15px] text-text-primary">
          {t('marketplace.difyMarketplace', { ns: 'plugin' })}
        </span>
      </Link>

      <div className="flex h-full items-center gap-0.5">
        <CreatorCenter />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
