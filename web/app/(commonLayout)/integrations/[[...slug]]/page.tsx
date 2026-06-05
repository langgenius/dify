import type { IntegrationRouteSearchParams } from '@/app/components/integrations/routes'
import IntegrationsPage from '@/app/components/integrations/page'
import { getIntegrationRouteTargetBySlug } from '@/app/components/integrations/routes'
import { notFound, redirect } from '@/next/navigation'

type IntegrationsRoutePageProps = {
  params: Promise<{
    slug?: string[]
  }>
  searchParams?: Promise<IntegrationRouteSearchParams>
}

const IntegrationsRoutePage = async ({
  params,
  searchParams,
}: IntegrationsRoutePageProps) => {
  const { slug } = await params
  const target = getIntegrationRouteTargetBySlug(slug, await searchParams)

  if (target.type === 'redirect')
    redirect(target.destination)

  if (target.type === 'not-found')
    notFound()

  return <IntegrationsPage section={target.section} />
}

export default IntegrationsRoutePage
