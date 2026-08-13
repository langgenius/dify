/* oxlint-disable react/only-export-components -- Next.js requires metadata and page exports in the route file. */
import { getRouteMetadata } from '@/app/route-metadata'
import { CreateKnowledgePage } from '@/features/new-rag/create-knowledge-page'

export function generateMetadata() {
  return getRouteMetadata('dataset', ($) => $['newKnowledge.createTitle'])
}

export default function Page() {
  return <CreateKnowledgePage />
}
