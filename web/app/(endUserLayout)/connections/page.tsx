import Connections from '@/app/components/end-user/connections'
import { demoProviders } from '@/app/components/end-user/connections/demo-data'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('app', ($) => $['endUser.myConnections'])
}

export default function Page() {
  return <Connections providers={demoProviders} />
}
