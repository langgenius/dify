import { Apps } from '@/app/components/apps'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['menus.apps'])
}

export default function AppsPage() {
  return <Apps />
}
