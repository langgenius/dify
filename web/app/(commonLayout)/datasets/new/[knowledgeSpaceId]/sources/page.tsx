import { SourcesPage } from '@/features/new-rag/sources-page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <SourcesPage knowledgeSpaceId={knowledgeSpaceId} />
}
