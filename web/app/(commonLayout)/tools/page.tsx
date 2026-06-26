import type { LegacyToolsSearchParams } from '@/app/components/integrations/routes'
import { getIntegrationRedirectPathByLegacyToolsSearchParams } from '@/app/components/integrations/routes'
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
