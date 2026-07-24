import { CreateKnowledgePage } from '@/features/new-rag/create-knowledge-page'
import { KnowledgeRouteGuard } from '@/features/new-rag/knowledge-route-guard'

export default function Page() {
  return (
    <KnowledgeRouteGuard>
      <CreateKnowledgePage />
    </KnowledgeRouteGuard>
  )
}
