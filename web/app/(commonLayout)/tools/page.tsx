import type { LegacyToolsSearchParams } from '@/app/components/tools/integration-routes'
import { getIntegrationRedirectPathByLegacyToolsSearchParams } from '@/app/components/tools/integration-routes'
import { redirect } from '@/next/navigation'

type ToolsPageProps = {
  searchParams?: Promise<LegacyToolsSearchParams>
}

const ToolsPage = async ({
  searchParams,
}: ToolsPageProps) => {
  const resolvedSearchParams = await searchParams

  redirect(getIntegrationRedirectPathByLegacyToolsSearchParams(resolvedSearchParams))
}

export default ToolsPage
