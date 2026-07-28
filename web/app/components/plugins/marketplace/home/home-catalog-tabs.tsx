import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { getMarketplaceUrl } from '@/utils/var'

type HomeCatalogTabsProps = {
  className?: string
  compact?: boolean
  isMarketplacePlatform: boolean
}

const HomeCatalogTabs = ({
  className,
  compact = false,
  isMarketplacePlatform,
}: HomeCatalogTabsProps) => {
  const { t } = useTranslation()
  const pluginsHref = isMarketplacePlatform ? '/plugins' : getMarketplaceUrl('/plugins')
  const templatesHref = isMarketplacePlatform ? '/templates' : getMarketplaceUrl('/templates')

  return (
    <nav
      aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
      className={cn('flex h-8 items-center gap-1', className)}
    >
      <Link
        href={pluginsHref}
        aria-current="page"
        className={cn(
          'relative flex h-8 cursor-pointer items-start rounded-lg px-[9px] pt-2 body-sm-medium outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact ? 'bg-state-base-active text-text-primary' : 'text-text-accent',
        )}
      >
        {t(($) => $['marketplace.home.plugins'], { ns: 'plugin' })}
        {!compact && (
          <span
            aria-hidden
            className="absolute bottom-0 left-1/2 h-0.5 w-[21px] -translate-x-1/2 rounded-full bg-text-accent"
          />
        )}
      </Link>
      <Link
        href={templatesHref}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-2 rounded-[10px] p-2 body-sm-regular outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact ? 'text-text-tertiary' : 'text-text-primary',
        )}
      >
        <span>{t(($) => $['marketplace.home.templates'], { ns: 'plugin' })}</span>
        {!compact && (
          <span className="flex items-center rounded-full bg-saas-dify-blue-accessible px-[5px] py-0.5 system-2xs-regular text-text-primary-on-surface uppercase">
            {t(($) => $['marketplace.home.new'], { ns: 'plugin' })}
          </span>
        )}
      </Link>
    </nav>
  )
}

export default HomeCatalogTabs
