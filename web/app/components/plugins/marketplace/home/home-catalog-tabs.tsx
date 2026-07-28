import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { getMarketplaceUrl } from '@/utils/var'

export type HomeCatalogTab = 'plugins' | 'templates'

type HomeCatalogTabsProps = {
  activeTab?: HomeCatalogTab
  className?: string
  compact?: boolean
  isMarketplacePlatform: boolean
}

const HomeCatalogTabs = ({
  activeTab = 'plugins',
  className,
  compact = false,
  isMarketplacePlatform,
}: HomeCatalogTabsProps) => {
  const { t } = useTranslation()
  const pluginsHref = isMarketplacePlatform ? '/plugins' : getMarketplaceUrl('/plugins')
  const templatesHref = isMarketplacePlatform ? '/templates' : getMarketplaceUrl('/templates')
  const isPluginsActive = activeTab === 'plugins'
  const isTemplatesActive = activeTab === 'templates'
  const pluginsLabel = t(($) => $['marketplace.home.plugins'], { ns: 'plugin' })
  const templatesLabel = t(($) => $['marketplace.home.templates'], { ns: 'plugin' })

  return (
    <nav
      aria-label={t(($) => $['mainNav.marketplace'], { ns: 'common' })}
      className={cn('flex h-8 items-center gap-1', className)}
    >
      <Link
        href={pluginsHref}
        aria-label={pluginsLabel}
        aria-current={isPluginsActive ? 'page' : undefined}
        className={cn(
          'relative flex h-8 cursor-pointer items-start rounded-lg px-[9px] pt-2 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isPluginsActive ? 'body-sm-medium' : 'body-sm-regular',
          compact
            ? isPluginsActive
              ? 'bg-state-base-active text-text-primary'
              : 'text-text-tertiary hover:bg-state-base-hover'
            : isPluginsActive
              ? 'text-text-accent'
              : 'text-text-primary hover:bg-state-base-hover',
        )}
      >
        {pluginsLabel}
        {isPluginsActive && !compact && (
          <span
            aria-hidden
            className="absolute bottom-0 left-1/2 h-0.5 w-[21px] -translate-x-1/2 rounded-full bg-text-accent"
          />
        )}
      </Link>
      <Link
        href={templatesHref}
        aria-label={templatesLabel}
        aria-current={isTemplatesActive ? 'page' : undefined}
        className={cn(
          'relative flex h-8 cursor-pointer items-center gap-2 rounded-[10px] p-2 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isTemplatesActive ? 'body-sm-medium' : 'body-sm-regular',
          compact
            ? isTemplatesActive
              ? 'bg-state-base-active text-text-primary'
              : 'text-text-tertiary hover:bg-state-base-hover'
            : isTemplatesActive
              ? 'text-text-accent'
              : 'text-text-primary hover:bg-state-base-hover',
        )}
      >
        <span>{templatesLabel}</span>
        {!compact && (
          <span className="flex items-center rounded-full bg-saas-dify-blue-accessible px-[5px] py-0.5 system-2xs-regular text-text-primary-on-surface uppercase">
            {t(($) => $['marketplace.home.new'], { ns: 'plugin' })}
          </span>
        )}
        {isTemplatesActive && !compact && (
          <span
            aria-hidden
            className="absolute bottom-0 left-1/2 h-0.5 w-[21px] -translate-x-1/2 rounded-full bg-text-accent"
          />
        )}
      </Link>
    </nav>
  )
}

export default HomeCatalogTabs
