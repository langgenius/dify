'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import Link from '@/next/link'

type HomeHeaderProps = {
  actions?: React.ReactNode
  brandName?: React.ReactNode
  isMarketplacePlatform: boolean
}

const CreatorCenter = () => (
  <Link href="https://creators.dify.ai/" target="_blank" rel="noopener noreferrer">
    <Button
      variant="ghost"
      className="flex w-[133px] items-center justify-start gap-0.5 p-0 text-components-button-secondary-accent-text hover:bg-state-base-hover"
    >
      <span aria-hidden className="i-ri-tools-fill size-4" />
      <span className="hidden px-0.5 system-sm-medium lg:inline">Creator Center</span>
      <span aria-hidden className="i-ri-question-line size-4 text-text-tertiary" />
    </Button>
  </Link>
)

const HomeHeader = ({
  actions,
  brandName,
  isMarketplacePlatform,
}: HomeHeaderProps) => {
  const { t } = useTranslation('common')

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center justify-between bg-background-default px-4 backdrop-blur-sm md:px-9',
        isMarketplacePlatform ? 'h-[46px]' : 'h-11',
      )}
    >
      <Link href="/" className="flex h-full w-[142px] items-center">
        <DifyLogo size="small" className="h-[18px] w-[39px] shrink-0" />
        <span
          className="ml-1 whitespace-nowrap text-[13px] leading-[15px] font-semibold text-text-primary"
          style={{ transform: 'scaleX(1.26)', transformOrigin: 'left center' }}
        >
          {brandName ?? t(($) => $['mainNav.marketplace'])}
        </span>
      </Link>

      <div className="flex h-full items-center gap-2.5">
        <CreatorCenter />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
