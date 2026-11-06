import { Apps } from '@/app/components/apps'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['menus.apps'])
}

// `/apps/create?mode=<app type>`: the Studio with the blank creation dialog open.
export default function CreateAppPage() {
  return <Apps opensCreateDialog />
}
