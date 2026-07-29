import { KnowledgeOverviewPage } from '@/features/new-rag/overview/knowledge-overview-page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <KnowledgeOverviewPage knowledgeSpaceId={knowledgeSpaceId} />
}
