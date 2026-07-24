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

const CreatorCenter = ({
  isMarketplacePlatform,
}: Pick<HomeHeaderProps, 'isMarketplacePlatform'>) => (
  <Link href="https://creators.dify.ai/" target="_blank" rel="noopener noreferrer">
    <Button
      variant="ghost"
      className={cn(
        'flex items-center',
        isMarketplacePlatform
          ? 'w-[133px] justify-start gap-0.5 p-0 text-components-button-secondary-accent-text hover:bg-state-base-hover'
          : 'gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-4',
          isMarketplacePlatform
            ? 'i-ri-tools-fill'
            : 'i-ri-user-star-line',
        )}
      />
      <span className="hidden px-0.5 system-sm-medium lg:inline">Creator Center</span>
      {isMarketplacePlatform && (
        <span aria-hidden className="i-ri-question-line size-4 text-text-tertiary" />
      )}
    </Button>
  </Link>
)

const HomeHeader = ({
  actions,
  brandName,
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
        <span
          className="ml-1 whitespace-nowrap text-[13px] leading-[15px] font-semibold text-text-primary"
          style={isMarketplacePlatform
            ? { transform: 'scaleX(1.26)', transformOrigin: 'left center' }
            : undefined}
        >
          {brandName ?? t(($) => $['marketplace.difyMarketplace'])}
        </span>
      </Link>

      <div
        className={cn(
          'flex h-full items-center',
          isMarketplacePlatform ? 'gap-2.5' : 'gap-0.5',
        )}
      >
        <CreatorCenter isMarketplacePlatform={isMarketplacePlatform} />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
