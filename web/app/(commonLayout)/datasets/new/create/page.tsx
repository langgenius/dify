import { getRouteMetadata } from '@/app/route-metadata'
import { CreateKnowledgePage } from '@/features/new-rag/create/page'

export function generateMetadata() {
  return getRouteMetadata('dataset', ($) => $['newKnowledge.createTitle'])
}

export default function Page() {
  return <CreateKnowledgePage />
}
