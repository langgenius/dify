'use client'

import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { getMarketplaceUrl } from '@/utils/var'
import PluginTypeSwitch from '../plugin-type-switch'

type HomeCatalogNavigationProps = {
  isMarketplacePlatform: boolean
}

function HomeCatalogNavigation({ isMarketplacePlatform }: HomeCatalogNavigationProps) {
  const { t } = useTranslation()
  const templatesHref = isMarketplacePlatform ? '/templates' : getMarketplaceUrl('/templates')

  return (
    <section
      aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
      className="w-full shrink-0 bg-background-default px-9 pt-6 pb-4"
    >
      <div className="w-full">
        <nav
          aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
          className="-ml-2 flex h-8 items-center gap-1"
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
        <PluginTypeSwitch className="mt-4" variant="home" />
      </div>
    </section>
  )
}

export default HomeCatalogNavigation
