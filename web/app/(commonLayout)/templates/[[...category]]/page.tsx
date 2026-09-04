import { MARKETPLACE_CONTAINER_ID } from '@/app/components/plugins/marketplace/constants'
import { EmbeddedTemplatesMarketplace } from '@/app/components/plugins/marketplace/templates'
import { isTemplateCategory } from '@/app/components/plugins/marketplace/templates/categories'
import { getLocaleOnServer } from '@/i18n-config/server'
import { redirect } from '@/next/navigation'

type TemplatesPageProps = {
  params: Promise<{ category?: string[] }>
  searchParams: Promise<{
    languages?: string | string[]
    page?: string
    q?: string
    sort_by?: string
    sort_order?: string
    tid?: string
    view?: string
  }>
}

// These values arrive from a public URL, so validate them against the
// supported enums here at the route boundary. Unknown values fall back to the
// defaults instead of reaching the Marketplace API, where e.g.
// `sort_order=garbage` fails and would surface as a false "no templates" state.
const TEMPLATE_SORT_FIELDS = new Set(['usage_count', 'created_at'])
const TEMPLATE_SORT_ORDERS = new Set(['ASC', 'DESC'])

const parseView = (value?: string) => (value === 'search' ? 'search' : undefined)

const parseSortBy = (value?: string) =>
  value && TEMPLATE_SORT_FIELDS.has(value) ? value : undefined

const parseSortOrder = (value?: string) =>
  value && TEMPLATE_SORT_ORDERS.has(value) ? value : undefined

const parsePage = (value?: string) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

// Sync route: async pages under this client shell Flight-double-resolve.
export default function TemplatesPage(props: TemplatesPageProps) {
  return (
    <div
      id={MARKETPLACE_CONTAINER_ID}
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <TemplatesPageContent {...props} />
    </div>
  )
}

async function TemplatesPageContent({ params, searchParams }: TemplatesPageProps) {
  const [resolvedParams, resolvedSearchParams, locale] = await Promise.all([
    params,
    searchParams,
    getLocaleOnServer(),
  ])

  if (resolvedSearchParams.tid) {
    redirect(`/apps?template-id=${encodeURIComponent(resolvedSearchParams.tid)}`)
  }

  const requestedCategory = resolvedParams.category?.[0]
  const category = isTemplateCategory(requestedCategory) ? requestedCategory : 'all'

  return (
    <EmbeddedTemplatesMarketplace
      category={category}
      languages={resolvedSearchParams.languages}
      locale={locale}
      page={parsePage(resolvedSearchParams.page)}
      query={resolvedSearchParams.q ?? ''}
      sortBy={parseSortBy(resolvedSearchParams.sort_by)}
      sortOrder={parseSortOrder(resolvedSearchParams.sort_order)}
      view={parseView(resolvedSearchParams.view)}
    />
  )
}
