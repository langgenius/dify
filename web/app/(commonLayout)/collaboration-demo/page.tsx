import { getRouteMetadata } from '@/app/route-metadata'
import CollaborationDemoPage from '@/features/collaboration-demo/page'

export function generateMetadata() {
  return getRouteMetadata('collaborationDemo', ($) => $.title)
}

export default function Page() {
  return <CollaborationDemoPage />
}
