'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { getMarketplaceUrl } from '@/utils/var'

type HomeCatalogTabsProps = {
  className?: string
  isMarketplacePlatform: boolean
}

const HomeCatalogTabs = ({ className, isMarketplacePlatform }: HomeCatalogTabsProps) => {
  const { t } = useTranslation()
  const templatesHref = isMarketplacePlatform ? '/templates' : getMarketplaceUrl('/templates')

  return (
    <nav
      aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
      className={cn('flex h-8 items-center gap-1', className)}
    >
      <span
        aria-current="page"
        className="relative flex h-8 items-start px-[9px] pt-2 body-sm-medium text-text-accent"
      >
        {t(($) => $['marketplace.home.plugins'], { ns: 'plugin' })}
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 h-0.5 w-[21px] -translate-x-1/2 rounded-full bg-text-accent"
        />
      </span>
      <Link
        href={templatesHref}
        className="flex h-8 items-center gap-2 rounded-[10px] p-2 body-sm-regular text-text-primary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span>{t(($) => $['marketplace.home.templates'], { ns: 'plugin' })}</span>
        <span className="flex items-center rounded-full bg-saas-dify-blue-accessible px-[5px] py-0.5 system-2xs-regular text-text-primary-on-surface uppercase">
          {t(($) => $['marketplace.home.new'], { ns: 'plugin' })}
        </span>
      </Link>
    </nav>
  )
}

export default HomeCatalogTabs
