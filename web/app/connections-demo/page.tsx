import { getRouteMetadata } from '@/app/route-metadata'
import ConnectionsDemo from './demo'

export function generateMetadata() {
  return getRouteMetadata('share', ($) => $['connections.required.title'])
}

export default function ConnectionsDemoPage() {
  return <ConnectionsDemo />
}
