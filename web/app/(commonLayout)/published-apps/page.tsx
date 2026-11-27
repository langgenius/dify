import PublishedApps from '@/app/components/explore/published-apps'
import { getRouteMetadata } from '@/app/route-metadata'

export async function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['mainNav.publishedApps'])
}

export default function Page() {
  return <PublishedApps />
}
