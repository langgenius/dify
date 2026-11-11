import type { PropsWithChildren } from 'react'
import { IntegrationsRoutePage } from '@/app/components/integrations/route-page'

// Rendered here so the page stays mounted across sections; the route segment only validates the slug.
export default function IntegrationsLayout({ children }: PropsWithChildren) {
  return (
    <>
      <IntegrationsRoutePage />
      {children}
    </>
  )
}
