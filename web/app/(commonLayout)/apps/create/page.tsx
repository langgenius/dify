import { CreateAppRoute } from '@/app/components/apps/create-app-route'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['menus.apps'])
}

// Visited directly, `/apps/create?mode=<app type>` shows only the creation dialog.
export default function CreateAppPage() {
  return <CreateAppRoute />
}
