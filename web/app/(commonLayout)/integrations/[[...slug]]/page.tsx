import { getIntegrationRouteTargetBySlug } from '@/app/components/tools/integration-routes'
import IntegrationsPage from '@/app/components/tools/integrations-page'
import { notFound, redirect } from '@/next/navigation'

type IntegrationsRoutePageProps = {
  params: Promise<{
    slug?: string[]
  }>
}

const IntegrationsRoutePage = async ({
  params,
}: IntegrationsRoutePageProps) => {
  const { slug } = await params
  const target = getIntegrationRouteTargetBySlug(slug)

  if (target.type === 'redirect')
    redirect(target.destination)

  if (target.type === 'not-found')
    notFound()

  return <IntegrationsPage section={target.section} />
}

export default IntegrationsRoutePage
