import { KnowledgeSpaceShell } from '@/features/new-rag/knowledge-space-shell'

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ knowledgeSpaceId: string }>
}) {
  const { knowledgeSpaceId } = await params

  return <KnowledgeSpaceShell knowledgeSpaceId={knowledgeSpaceId}>{children}</KnowledgeSpaceShell>
}
