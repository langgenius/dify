import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import HomeCatalogTabs from './home-catalog-tabs'
import { HomeStickyCatalogTabs } from './home-sticky-state-provider'
import styles from './home-sticky.module.css'

type HomeHeaderProps = {
  actions?: React.ReactNode
  brandName?: React.ReactNode
  isMarketplacePlatform: boolean
}

function Guide() {
  const docLink = useDocLink()

  return (
    <Link href={docLink()} target="_blank" rel="noopener noreferrer" className={styles.guide}>
      <Button variant="ghost" size="large" className="w-[94px] gap-0.5 px-3 text-text-primary">
        <span aria-hidden className="i-ri-map-2-line size-5" />
        <span className="px-1 system-md-medium">Guide</span>
      </Button>
    </Link>
  )
}

const HomeHeader = ({ actions, brandName, isMarketplacePlatform }: HomeHeaderProps) => {
  const { t } = useTranslation('common')

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex w-full shrink-0 items-center gap-4 border-b border-divider-regular bg-background-default px-4 py-1.5 md:px-9',
        styles.header,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link href="/" className={cn('flex h-full w-[142px] shrink-0 items-center', styles.brand)}>
          <DifyLogo size="small" className="h-[18px] w-[39px] shrink-0" />
          <span
            className={cn(
              'ml-1 text-[12.94px] leading-[14.786px] font-medium whitespace-nowrap text-dify-logo-black not-italic [text-box-edge:cap] [text-box-trim:trim-both]',
              styles.brandName,
            )}
            style={{ fontFamily: "var(--font-family-brand, 'Söhne', var(--font-sans))" }}
          >
            {brandName ?? t(($) => $['mainNav.marketplace'])}
          </span>
        </Link>
        <HomeStickyCatalogTabs>
          <HomeCatalogTabs
            className={styles.headerCatalogTabs}
            compact
            isMarketplacePlatform={isMarketplacePlatform}
          />
        </HomeStickyCatalogTabs>
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center justify-end gap-2.5">
        <Guide />
        {actions}
      </div>
    </header>
  )
}

export default HomeHeader
