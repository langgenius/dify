import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { TemplateCategory } from './categories'
import type { Locale } from '@/i18n-config'
import { cn } from '@langgenius/dify-ui/cn'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { getTranslation } from '@/i18n-config/server'
import Link from '@/next/link'
import {
  getMarketplaceTemplateCollectionsAndTemplates,
  searchMarketplaceTemplates,
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

export async function EmbeddedTemplatesMarketplace({
  category,
  locale,
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
    collectionsResult,
    searchResult,
    banners,
  ] = await Promise.all([
    getTranslation(locale, 'plugin'),
    getTranslation(locale, 'app'),
    getTranslation(locale, 'explore'),
    getTranslation(locale, 'pluginTags'),
    showCollections ? getMarketplaceTemplateCollectionsAndTemplates() : Promise.resolve(null),
    showCollections
      ? Promise.resolve(null)
      : searchMarketplaceTemplates({
          category,
          query: normalizedQuery,
          sortBy,
          sortOrder,
        }),
    fetchPluginBanners(locale).catch(() => []),
  ])
  const categoryLabels: TemplateCategoryLabels = {
    all: tPlugin('category.all' as never),
    marketing: tApp('marketplace.template.category.marketing' as never),
    sales: tApp('marketplace.template.category.sales' as never),
    support: tApp('marketplace.template.category.support' as never),
    operations: tApp('marketplace.template.category.operations' as never),
    it: tApp('marketplace.template.category.it' as never),
    knowledge: tApp('marketplace.template.category.knowledge' as never),
    design: tApp('marketplace.template.category.design' as never),
    others: tPluginTags('tags.other' as never),
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
  const pluginsLabel = tPlugin('marketplace.home.plugins' as never)
  const templatesLabel = tPlugin('marketplace.home.templates' as never)
  const partnerText = tPlugin('marketplace.partnerTip' as never)

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
            subtitle={tExplore('apps.description' as never)}
          />
          <HomeSearch>
            <MarketplaceSearchForm
              action={category === 'all' ? '/templates' : `/templates/${category}`}
              category={category}
              className="w-full"
              locale={locale}
              placeholder={tApp('newAppFromTemplate.searchAllTemplate' as never)}
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
                ariaLabel={tPlugin('allCategories' as never)}
                labels={categoryLabels}
                query={query}
              />
            }
          />
          <main
            className={cn(
              'relative flex grow flex-col bg-background-default px-8 py-2',
              styles.catalogContent,
            )}
          >
            {collectionsResult ? (
              hasVisibleCollections ? (
                <TemplateCollectionList
                  becomePartnerText={tPlugin('marketplace.becomePartner' as never)}
                  collections={collectionsResult.collections}
                  locale={locale}
                  partnerText={partnerText}
                  templatesByCollection={collectionsResult.templatesByCollection}
                  viewMoreText={tPlugin('marketplace.viewMore' as never)}
                />
              ) : (
                <EmptyState>{tApp('newApp.noTemplateFound' as never)}</EmptyState>
              )
            ) : (
              <>
                <div className="mb-5 text-right text-sm text-text-tertiary">
                  {tExplore('apps.resultNum' as never, { num: searchResult?.total ?? 0 })}
                </div>
                {templates.length > 0 ? (
                  <TemplateGrid partnerText={partnerText} templates={templates} />
                ) : (
                  <EmptyState>{tApp('newApp.noTemplateFound' as never)}</EmptyState>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </HomeStickyStateProvider>
  )
}
