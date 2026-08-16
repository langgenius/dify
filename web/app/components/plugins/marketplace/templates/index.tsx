import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { TemplateCategory } from './categories'
import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { getTranslation } from '@/i18n-config/server'
import Link from '@/next/link'
import { redirect } from '@/next/navigation'
import {
  getMarketplaceTemplateCollectionsAndTemplates,
  searchMarketplaceTemplates,
  TEMPLATE_SEARCH_PAGE_SIZE,
} from '@/service/marketplace-template-discovery'
import { fetchPluginBanners } from '../home/banners'
import HomeCatalogNavigation from '../home/home-catalog-navigation'
import HomeCatalogTabs from '../home/home-catalog-tabs'
import HomeHeader from '../home/home-header'
import HomeHero from '../home/home-hero'
import HomeSearch from '../home/home-search'
import { HomeStickyStateProvider } from '../home/home-sticky-state-provider'
import styles from '../home/home-sticky.module.css'
import HomeTrending from '../home/home-trending'
import { MarketplaceSearchForm } from '../home/marketplace-search-autocomplete'
import { GRID_CLASS } from '../list/collection-constants'
import pluginTypeStyles from '../plugin-type-switch.module.css'
import { TEMPLATE_CATEGORIES } from './categories'
import TemplateCard from './template-card'
import TemplateCollectionList from './template-collection-list'
import { filterTemplatesForLocale } from './template-language'

type EmbeddedTemplatesMarketplaceProps = {
  category: TemplateCategory
  locale: Locale
  page?: number
  query: string
  sortBy?: string
  sortOrder?: string
  view?: string
}

type TemplateCategoryLabels = Record<TemplateCategory, string>

function TemplateCategoryNavigation({
  activeCategory,
  ariaLabel,
  labels,
  query,
}: {
  activeCategory: TemplateCategory
  ariaLabel: string
  labels: TemplateCategoryLabels
  query: string
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-full shrink-0 scrollbar-none items-center justify-start gap-1 overflow-x-auto"
    >
      {TEMPLATE_CATEGORIES.map((category) => {
        const searchParams = new URLSearchParams()
        if (query) searchParams.set('q', query)
        const queryString = searchParams.toString()
        const href = `/templates/${category}${queryString ? `?${queryString}` : ''}`

        return (
          <Link
            key={category}
            href={href}
            scroll={false}
            aria-current={category === activeCategory ? 'page' : undefined}
            className={cn(
              'flex h-8 min-w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent px-2.5 system-md-medium whitespace-nowrap text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              pluginTypeStyles.homeItem,
              category === activeCategory && pluginTypeStyles.homeItemActive,
            )}
          >
            {labels[category]}
          </Link>
        )
      })}
    </nav>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-60 items-center justify-center rounded-xl border border-dashed border-divider-regular text-sm text-text-tertiary">
      {children}
    </div>
  )
}

function TemplateGrid({
  partnerText,
  templates,
}: {
  partnerText: string
  templates: MarketplaceTemplate[]
}) {
  return (
    <div className={GRID_CLASS}>
      {templates.map((template) => (
        <TemplateCard key={template.id} partnerText={partnerText} template={template} />
      ))}
    </div>
  )
}

const PAGE_LINK_CLASS =
  'flex h-8 items-center justify-center rounded-lg border-[0.5px] border-divider-regular px-3 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
const PAGE_LINK_DISABLED_CLASS =
  'flex h-8 cursor-not-allowed items-center justify-center rounded-lg border-[0.5px] border-divider-subtle px-3 system-sm-medium text-text-quaternary'

type TemplatesHrefOptions = {
  category: TemplateCategory
  page?: number
  query?: string
  sortBy?: string
  sortOrder?: string
  view?: string
}

function buildTemplatesHref({
  category,
  page = 1,
  query,
  sortBy,
  sortOrder,
  view,
}: TemplatesHrefOptions) {
  const searchParams = new URLSearchParams()
  if (query) searchParams.set('q', query)
  if (sortBy) searchParams.set('sort_by', sortBy)
  if (sortOrder) searchParams.set('sort_order', sortOrder)
  if (view) searchParams.set('view', view)
  if (page > 1) searchParams.set('page', String(page))
  const queryString = searchParams.toString()
  const basePath = category === 'all' ? '/templates' : `/templates/${category}`
  return queryString ? `${basePath}?${queryString}` : basePath
}

// The retry link is a plain anchor on purpose: a full navigation re-runs the
// failed (and uncached) server fetch instead of reusing the router cache.
function LoadErrorState({
  message,
  retryHref,
  retryLabel,
}: {
  message: string
  retryHref: string
  retryLabel: string
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-divider-regular text-sm text-text-tertiary">
      <span>{message}</span>
      <a href={retryHref} className={PAGE_LINK_CLASS}>
        {retryLabel}
      </a>
    </div>
  )
}

// Server-rendered pagination: plain links keep the search results reachable
// beyond the first page without any client-side state.
function TemplatePagination({
  category,
  navigationLabel,
  nextLabel,
  page,
  pageCount,
  previousLabel,
  query,
  sortBy,
  sortOrder,
  view,
}: {
  category: TemplateCategory
  navigationLabel: string
  nextLabel: string
  page: number
  pageCount: number
  previousLabel: string
  query: string
  sortBy?: string
  sortOrder?: string
  view?: string
}) {
  if (pageCount <= 1) return null

  const buildHref = (targetPage: number) =>
    buildTemplatesHref({ category, page: targetPage, query, sortBy, sortOrder, view })

  return (
    <nav aria-label={navigationLabel} className="mt-6 flex items-center justify-center gap-3 pb-4">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={PAGE_LINK_CLASS}>
          {previousLabel}
        </Link>
      ) : (
        <span aria-disabled="true" className={PAGE_LINK_DISABLED_CLASS}>
          {previousLabel}
        </span>
      )}
      <span aria-current="page" className="system-sm-regular text-text-tertiary">
        {page} / {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={buildHref(page + 1)} className={PAGE_LINK_CLASS}>
          {nextLabel}
        </Link>
      ) : (
        <span aria-disabled="true" className={PAGE_LINK_DISABLED_CLASS}>
          {nextLabel}
        </span>
      )}
    </nav>
  )
}

export async function EmbeddedTemplatesMarketplace({
  category,
  locale,
  page = 1,
  query,
  sortBy,
  sortOrder,
  view,
}: EmbeddedTemplatesMarketplaceProps) {
  const normalizedQuery = query.trim()
  const showCollections = category === 'all' && !normalizedQuery && view !== 'search'
  const [
    { t: tPlugin },
    { t: tApp },
    { t: tExplore },
    { t: tPluginTags },
    { t: tCommon },
    collectionsResult,
    searchResult,
    banners,
  ] = await Promise.all([
    getTranslation(locale, 'plugin'),
    getTranslation(locale, 'app'),
    getTranslation(locale, 'explore'),
    getTranslation(locale, 'pluginTags'),
    getTranslation(locale, 'common'),
    showCollections ? getMarketplaceTemplateCollectionsAndTemplates() : Promise.resolve(null),
    showCollections
      ? Promise.resolve(null)
      : searchMarketplaceTemplates({
          category,
          page,
          query: normalizedQuery,
          sortBy,
          sortOrder,
        }),
    fetchPluginBanners(locale).catch(() => []),
  ])
  const categoryLabels: TemplateCategoryLabels = {
    all: tPlugin(($) => $['category.all'], { ns: 'plugin' }),
    marketing: tApp(($) => $['marketplace.template.category.marketing'], { ns: 'app' }),
    sales: tApp(($) => $['marketplace.template.category.sales'], { ns: 'app' }),
    support: tApp(($) => $['marketplace.template.category.support'], { ns: 'app' }),
    operations: tApp(($) => $['marketplace.template.category.operations'], { ns: 'app' }),
    it: tApp(($) => $['marketplace.template.category.it'], { ns: 'app' }),
    knowledge: tApp(($) => $['marketplace.template.category.knowledge'], { ns: 'app' }),
    design: tApp(($) => $['marketplace.template.category.design'], { ns: 'app' }),
    others: tPluginTags(($) => $['tags.other'], { ns: 'pluginTags' }),
  }
  const pageCount = Math.ceil((searchResult?.total ?? 0) / TEMPLATE_SEARCH_PAGE_SIZE)
  // An out-of-range ?page= would render a misleading empty state; send the
  // visitor to the last page that actually exists instead.
  if (searchResult?.ok && searchResult.total > 0 && page > pageCount) {
    redirect(
      buildTemplatesHref({
        category,
        page: pageCount,
        query: normalizedQuery,
        sortBy,
        sortOrder,
        view,
      }),
    )
  }

  const templates = filterTemplatesForLocale(searchResult?.templates ?? [], locale)
  const hasVisibleCollections =
    collectionsResult?.collections.some(
      (collection) =>
        filterTemplatesForLocale(
          collectionsResult.templatesByCollection[collection.name] ?? [],
          locale,
        ).length > 0,
    ) ?? false
  const pluginsLabel = tPlugin(($) => $['marketplace.home.plugins'], { ns: 'plugin' })
  const templatesLabel = tPlugin(($) => $['marketplace.home.templates'], { ns: 'plugin' })
  const partnerText = tPlugin(($) => $['marketplace.partnerTip'], { ns: 'plugin' })
  const loadFailed = collectionsResult
    ? !collectionsResult.ok
    : searchResult
      ? !searchResult.ok
      : false
  const currentHref = buildTemplatesHref({
    category,
    page,
    query: normalizedQuery,
    sortBy,
    sortOrder,
    view,
  })
  const loadErrorState = (
    <LoadErrorState
      message={tPlugin(($) => $['marketplace.loadError'], { ns: 'plugin' })}
      retryHref={currentHref}
      retryLabel={tCommon(($) => $['operation.retry'], { ns: 'common' })}
    />
  )

  return (
    <HomeStickyStateProvider>
      <div className="flex min-h-full w-full shrink-0 flex-col bg-background-default">
        <HomeHeader
          activeTab="templates"
          actions={
            <div className="p-0.5">
              <AccountSection compact />
            </div>
          }
          catalogLabels={{ plugins: pluginsLabel, templates: templatesLabel }}
          isMarketplacePlatform={false}
        />
        <div className="relative flex w-full flex-col">
          <HomeHero
            isMarketplacePlatform={false}
            title={templatesLabel}
            subtitle={tExplore(($) => $['apps.description'], { ns: 'explore' })}
          />
          <HomeSearch enableSearchShortcut={false}>
            <MarketplaceSearchForm
              action={category === 'all' ? '/templates' : `/templates/${category}`}
              category={category}
              className="w-full"
              locale={locale}
              placeholder={tApp(($) => $['newAppFromTemplate.searchAllTemplate'], { ns: 'app' })}
              query={query}
              scope="templates"
            />
          </HomeSearch>
          {banners.length > 0 && (
            <>
              <div aria-hidden="true" className="h-12 shrink-0" />
              <HomeTrending banners={banners} isMarketplacePlatform={false} />
            </>
          )}
          <HomeCatalogNavigation
            catalogTabs={
              <HomeCatalogTabs
                activeTab="templates"
                isMarketplacePlatform={false}
                labels={{ plugins: pluginsLabel, templates: templatesLabel }}
              />
            }
            catalogCategories={
              <TemplateCategoryNavigation
                activeCategory={category}
                ariaLabel={tPlugin(($) => $.allCategories, { ns: 'plugin' })}
                labels={categoryLabels}
                query={query}
              />
            }
          />
          {/* The app shell already renders the main landmark; use a plain div
              to avoid nested main elements. */}
          <div
            className={cn(
              'relative flex grow flex-col bg-background-default px-8 py-2',
              styles.catalogContent,
            )}
          >
            {loadFailed ? (
              loadErrorState
            ) : collectionsResult ? (
              hasVisibleCollections ? (
                <TemplateCollectionList
                  becomePartnerText={tPlugin(($) => $['marketplace.becomePartner'], {
                    ns: 'plugin',
                  })}
                  collections={collectionsResult.collections}
                  locale={locale}
                  partnerText={partnerText}
                  templatesByCollection={collectionsResult.templatesByCollection}
                  viewMoreText={tPlugin(($) => $['marketplace.viewMore'], { ns: 'plugin' })}
                />
              ) : (
                <EmptyState>{tApp(($) => $['newApp.noTemplateFound'], { ns: 'app' })}</EmptyState>
              )
            ) : (
              <>
                {/* The locale filter runs after pagination, so the API total
                    does not describe what is on screen; show the number of
                    templates actually rendered on this page instead. */}
                <div className="mb-5 text-right text-sm text-text-tertiary">
                  {tExplore(($) => $['apps.resultNum'], { ns: 'explore', num: templates.length })}
                </div>
                {templates.length > 0 ? (
                  <TemplateGrid partnerText={partnerText} templates={templates} />
                ) : (
                  <EmptyState>{tApp(($) => $['newApp.noTemplateFound'], { ns: 'app' })}</EmptyState>
                )}
                <TemplatePagination
                  category={category}
                  navigationLabel={tCommon(($) => $['pagination.pageNumber'], { ns: 'common' })}
                  nextLabel={tCommon(($) => $['pagination.next'], { ns: 'common' })}
                  page={page}
                  pageCount={pageCount}
                  previousLabel={tCommon(($) => $['pagination.previous'], { ns: 'common' })}
                  query={normalizedQuery}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  view={view}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </HomeStickyStateProvider>
  )
}
