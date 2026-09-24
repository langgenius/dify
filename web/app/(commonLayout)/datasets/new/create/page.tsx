import { getRouteMetadata } from '@/app/route-metadata'
import { CreateKnowledgePage } from '@/features/new-rag/create/page'

export function generateMetadata() {
  return getRouteMetadata('knowledgeCreate', ($) => $.createTitle)
}

export default function Page() {
  return <CreateKnowledgePage />
}
