'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import Link from '@/next/link'

type HomeHeaderProps = {
  actions?: React.ReactNode
  isMarketplacePlatform: boolean
}

const CreatorCenter = () => (
  <Link href="https://creators.dify.ai/" target="_blank" rel="noopener noreferrer">
    <Button
      variant="ghost"
      className="flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
    >
      <span className="i-ri-user-star-line size-4" />
      <span className="hidden system-sm-medium lg:inline">Creator Center</span>
    </Button>
  </Link>
)

const HomeHeader = ({
  actions,
  isMarketplacePlatform,
}: HomeHeaderProps) => {
  const { t } = useTranslation('plugin')

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center justify-between bg-background-default px-4 backdrop-blur-sm md:px-9',
        isMarketplacePlatform ? 'h-[46px]' : 'h-11',
      )}
    >
      <Link href="/" className="flex h-full w-[142px] items-center">
        <DifyLogo size="small" className="h-[18px] w-[39px] shrink-0" />
        <span className="ml-1 whitespace-nowrap text-[13px] leading-[15px] font-semibold text-text-primary">
          {t(($) => $['marketplace.difyMarketplace'])}
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
