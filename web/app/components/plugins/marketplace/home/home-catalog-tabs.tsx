import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import { getMarketplaceUrl } from '@/utils/var'

export type HomeCatalogTab = 'plugins' | 'templates'
export type HomeCatalogTabLabels = Record<HomeCatalogTab, string>

type HomeCatalogTabsProps = {
  activeTab?: HomeCatalogTab | null
  className?: string
  isMarketplacePlatform: boolean
  labels?: HomeCatalogTabLabels
  language?: string
  pluginsHref?: string
}

const HomeCatalogTabs = ({
  activeTab = 'plugins',
  className,
  isMarketplacePlatform,
  labels,
  language,
  pluginsHref: pluginsHrefOverride,
}: HomeCatalogTabsProps) => {
  const { t } = useTranslation()
  const catalogParams = language ? { language } : undefined
  const getRelativeCatalogHref = (path: string) => {
    const searchParams = new URLSearchParams(catalogParams)
    const queryString = searchParams.toString()
    return queryString ? `${path}?${queryString}` : path
  }
  const pluginsHref =
    pluginsHrefOverride ??
    (isMarketplacePlatform
      ? getRelativeCatalogHref('/plugins')
      : getMarketplaceUrl('/plugins', catalogParams))
  const templatesHref = getRelativeCatalogHref('/templates')
  const isPluginsActive = activeTab === 'plugins'
  const isTemplatesActive = activeTab === 'templates'
  const pluginsLabel = labels?.plugins ?? t(($) => $['marketplace.home.plugins'], { ns: 'plugin' })
  const templatesLabel =
    labels?.templates ?? t(($) => $['marketplace.home.templates'], { ns: 'plugin' })

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
          'flex h-8 cursor-pointer items-start rounded-lg px-[9px] pt-2 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isPluginsActive ? 'body-sm-medium' : 'body-sm-regular',
          isPluginsActive
            ? 'bg-state-base-active text-text-primary'
            : 'text-text-tertiary hover:bg-state-base-hover',
        )}
      >
        {pluginsLabel}
      </Link>
      <Link
        href={templatesHref}
        aria-label={templatesLabel}
        aria-current={isTemplatesActive ? 'page' : undefined}
        className={cn(
          'relative flex h-8 cursor-pointer items-center rounded-[10px] p-2 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          isTemplatesActive ? 'body-sm-medium' : 'body-sm-regular',
          isTemplatesActive
            ? 'bg-state-base-active text-text-primary'
            : 'text-text-tertiary hover:bg-state-base-hover',
        )}
      >
        {templatesLabel}
      </Link>
    </nav>
  )
}

export default HomeCatalogTabs
