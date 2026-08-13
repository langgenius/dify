/* oxlint-disable react/only-export-components -- Next.js requires metadata and page exports in the route file. */
import { getRouteMetadata } from '@/app/route-metadata'
import RosterPage from '@/features/agent-v2/roster/page'

export function generateMetadata() {
  return getRouteMetadata('agentV2', ($) => $['roster.title'])
}

export default function Page() {
  return <RosterPage />
}
