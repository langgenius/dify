import type { SearchParams } from 'nuqs'
import Marketplace from '@/app/components/plugins/marketplace'
import { getIntegrationRouteTargetBySlug } from '@/app/components/tools/integration-routes'
import IntegrationsPage from '@/app/components/tools/integrations-page'
import { notFound, redirect } from '@/next/navigation'

type IntegrationsRoutePageProps = {
  params: Promise<{
    slug?: string[]
  }>
  searchParams?: Promise<SearchParams>
}

const IntegrationsRoutePage = async ({
  params,
  searchParams,
}: IntegrationsRoutePageProps) => {
  const { slug } = await params
  const target = getIntegrationRouteTargetBySlug(slug)

  if (target.type === 'redirect')
    redirect(target.destination)

  if (target.type === 'not-found')
    notFound()

  return (
    <IntegrationsPage
      marketplace={<Marketplace searchParams={searchParams} />}
      section={target.section}
    />
  )
}

export default IntegrationsRoutePage
