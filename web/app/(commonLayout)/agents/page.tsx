import { getRouteMetadata } from '@/app/route-metadata'
import RosterPage from '@/features/agent-v2/roster/page'

export function generateMetadata() {
  return getRouteMetadata('agentRoster', ($) => $['roster.title'])
}

export default function Page() {
  return <RosterPage />
}
