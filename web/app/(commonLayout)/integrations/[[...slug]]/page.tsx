import type { IntegrationRouteSearchParams } from '@/app/components/integrations/routes'
import {
  buildIntegrationPath,
  getIntegrationRouteTargetBySlug,
} from '@/app/components/integrations/routes'
import { notFound, redirect } from '@/next/navigation'
import { consoleClient } from '@/service/console'

type IntegrationsRoutePageProps = {
  params: Promise<{
    slug?: string[]
  }>
  searchParams?: Promise<IntegrationRouteSearchParams>
}

const IntegrationsRoutePage = async ({ params, searchParams }: IntegrationsRoutePageProps) => {
  const { slug } = await params
  const target = getIntegrationRouteTargetBySlug(slug, await searchParams)

  if (target.type === 'redirect') redirect(target.destination)

  if (target.type === 'not-found') notFound()

  // The malware scanners section only exists in workspaces that have the feature turned on.
  if (target.section === 'file-scan') {
    const features = await consoleClient.features.get()
    if (!features.enable_file_scan) redirect(buildIntegrationPath('provider'))
  }

  return null
}

export default IntegrationsRoutePage
