import { Apps } from '@/app/components/apps'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('common', ($) => $['menus.apps'])
}

export default function AppsPage() {
  return <Apps />
}
