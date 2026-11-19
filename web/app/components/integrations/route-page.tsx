'use client'

import IntegrationsPage from '@/app/components/integrations'
import { getIntegrationRouteTargetBySlug } from '@/app/components/integrations/routes'
import { usePathname } from '@/next/navigation'

export function IntegrationsRoutePage() {
  const pathname = usePathname()
  const target = getIntegrationRouteTargetBySlug(pathname.split('/').filter(Boolean).slice(1))

  if (target.type !== 'section') return null

  return <IntegrationsPage section={target.section} syncDocumentTitle />
}
