import { RetrievalTestPage } from '@/features/new-rag/retrieval/page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <RetrievalTestPage knowledgeSpaceId={knowledgeSpaceId} />
}
