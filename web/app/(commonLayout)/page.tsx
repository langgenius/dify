import { getRouteMetadata } from '@/app/route-metadata'
import { HomePage } from '@/features/home/page'

export function generateMetadata() {
  return getRouteMetadata('navigation', ($) => $['mainNav.home'])
}

export default function Page() {
  return <HomePage />
}
