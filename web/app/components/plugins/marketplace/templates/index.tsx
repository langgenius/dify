import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { TemplateCategory } from './categories'
import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { getTranslation } from '@/i18n-config/server'
import { redirect } from '@/next/navigation'
import {
  getMarketplaceTemplateCollectionsAndTemplates,
  searchMarketplaceTemplates,
  TEMPLATE_SEARCH_PAGE_SIZE,
} from '@/service/marketplace-template-discovery'
import { fetchPluginBanners } from '../home/banners'
import CatalogLanguagesFilter from '../home/catalog-languages-filter'
import HomeCatalogNavigation from '../home/home-catalog-navigation'
import HomeCatalogTabs from '../home/home-catalog-tabs'
import HomeHeader from '../home/home-header'
import HomeHero from '../home/home-hero'
import HomeSearch from '../home/home-search'
import { HomeShell } from '../home/home-shell'
import styles from '../home/home-sticky.module.css'
import MarketplaceLiveSearch from '../home/marketplace-live-search'
import { GRID_CLASS } from '../list/collection-constants'
import TemplateCard from './template-card'
import TemplateCategoryNavigation from './template-category-navigation'
import TemplateCollectionList from './template-collection-list'
import { filterTemplatesForLocale, parseListParam } from './template-language'
import { buildTemplatesHref, PAGE_LINK_CLASS } from './template-links'
import TemplatePagination from './template-pagination'

type EmbeddedTemplatesMarketplaceProps = {
  category: TemplateCategory
  languages?: string | string[]
  locale: Locale
  page?: number
  query: string
  sortBy?: string
  sortOrder?: string
  view?: string
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

export async function EmbeddedTemplatesMarketplace({
  category,
  languages,
  locale,
  page = 1,
  query,
  sortBy,
  sortOrder,
  view,
}: EmbeddedTemplatesMarketplaceProps) {
  const normalizedQuery = query.trim()
  const selectedLanguages = parseListParam(languages)
  const showCollections =
    category === 'all' && !normalizedQuery && view !== 'search' && selectedLanguages.length === 0
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
          ...(selectedLanguages.length ? { languages: selectedLanguages } : {}),
        }),
    fetchPluginBanners(locale, 'templates').catch(() => []),
  ])
  const categoryLabels = {
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
        languages: selectedLanguages,
        page: pageCount,
        query: normalizedQuery,
        sortBy,
        sortOrder,
        view,
      }),
    )
  }

  const templates =
    selectedLanguages.length === 0
      ? filterTemplatesForLocale(searchResult?.templates ?? [], locale)
      : (searchResult?.templates ?? [])
  // The locale filter runs once here; the collection list receives templates
  // that are already scoped to the request locale.
  const visibleTemplatesByCollection = Object.fromEntries(
    (collectionsResult?.collections ?? []).map((collection) => [
      collection.name,
      filterTemplatesForLocale(
        collectionsResult?.templatesByCollection[collection.name] ?? [],
        locale,
      ),
    ]),
  )
  const hasVisibleCollections = (collectionsResult?.collections ?? []).some(
    (collection) => (visibleTemplatesByCollection[collection.name]?.length ?? 0) > 0,
  )
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
    languages: selectedLanguages,
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
    <HomeShell
      banners={banners}
      isMarketplacePlatform={false}
      page="templates"
      header={
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
      }
      hero={
        <HomeHero
          isMarketplacePlatform={false}
          title={templatesLabel}
          subtitle={tExplore(($) => $['apps.description'], { ns: 'explore' })}
        />
      }
      search={
        <HomeSearch enableSearchShortcut={false}>
          <MarketplaceLiveSearch
            action={category === 'all' ? '/templates' : `/templates/${category}`}
            className="w-full"
            placeholder={tApp(($) => $['newAppFromTemplate.searchAllTemplate'], { ns: 'app' })}
            preserveParams={selectedLanguages.length ? { languages: selectedLanguages } : undefined}
            query={query}
          />
        </HomeSearch>
      }
      navigation={
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
              languages={selectedLanguages}
              query={query}
            />
          }
          catalogTrailing={<CatalogLanguagesFilter />}
        />
      }
    >
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
              templatesByCollection={visibleTemplatesByCollection}
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
              languages={selectedLanguages}
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
    </HomeShell>
  )
}
