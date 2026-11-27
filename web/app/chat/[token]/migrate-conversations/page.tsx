import { getRouteMetadata } from '@/app/route-metadata'
import MigrateConversationsContent from './content'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['history.title'])
}

export default function MigrateConversationsPage() {
  return <MigrateConversationsContent />
}
