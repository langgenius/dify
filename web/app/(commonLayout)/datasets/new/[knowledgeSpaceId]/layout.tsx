import { KnowledgeRouteGuard } from '@/features/new-rag/knowledge-route-guard'
import { KnowledgeSpaceShell } from '@/features/new-rag/knowledge-space-shell'

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ knowledgeSpaceId: string }>
}) {
  const { knowledgeSpaceId } = await params

  return (
    <KnowledgeRouteGuard>
      <KnowledgeSpaceShell knowledgeSpaceId={knowledgeSpaceId}>{children}</KnowledgeSpaceShell>
    </KnowledgeRouteGuard>
  )
}
