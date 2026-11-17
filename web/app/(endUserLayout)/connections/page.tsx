import ConnectionsPage from '@/app/components/end-user/connections/connections-page'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('app', ($) => $['endUser.myConnections'])
}

export default function Page() {
  return <ConnectionsPage />
}
