import { EmbeddedTemplatesMarketplace } from '@/app/components/plugins/marketplace/templates'
import { isTemplateCategory } from '@/app/components/plugins/marketplace/templates/categories'
import { getLocaleOnServer } from '@/i18n-config/server'
import { redirect } from '@/next/navigation'

type TemplatesPageProps = {
  params: Promise<{ category?: string[] }>
  searchParams: Promise<{
    q?: string
    sort_by?: string
    sort_order?: string
    tid?: string
    view?: string
  }>
}

export default async function TemplatesPage({ params, searchParams }: TemplatesPageProps) {
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
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <EmbeddedTemplatesMarketplace
        category={category}
        locale={locale}
        query={resolvedSearchParams.q ?? ''}
        sortBy={resolvedSearchParams.sort_by}
        sortOrder={resolvedSearchParams.sort_order}
        view={resolvedSearchParams.view}
      />
    </div>
  )
}
