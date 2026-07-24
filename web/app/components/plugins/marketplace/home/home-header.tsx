'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import Link from '@/next/link'
import HomeCatalogTabs from './home-catalog-tabs'
import styles from './home-sticky.module.css'

type HomeHeaderProps = {
  actions?: React.ReactNode
  brandName?: React.ReactNode
  isMarketplacePlatform: boolean
  showCatalogTabs?: boolean
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
  showCatalogTabs = false,
}: HomeHeaderProps) => {
  const { t } = useTranslation('common')

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center gap-4 bg-background-default px-4 backdrop-blur-sm md:px-9',
        styles.header,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link href="/" className="flex h-full w-[142px] shrink-0 items-center">
          <DifyLogo size="small" className="h-[18px] w-[39px] shrink-0" />
          <span
            className="ml-1 text-[17.684px] leading-[20.21px] font-medium whitespace-nowrap text-dify-logo-black not-italic [text-box-edge:cap] [text-box-trim:trim-both]"
            style={{ fontFamily: "var(--font-family-brand, 'Söhne', var(--font-sans))" }}
          >
            {brandName ?? t(($) => $['mainNav.marketplace'])}
          </span>
        </Link>
        {showCatalogTabs && (
          <HomeCatalogTabs
            className={styles.headerCatalogTabs}
            isMarketplacePlatform={isMarketplacePlatform}
          />
        )}
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center justify-end gap-2.5">
        <CreatorCenter />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
