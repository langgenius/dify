import { AddSourcePage } from '@/features/new-rag/add-source-page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <AddSourcePage knowledgeSpaceId={knowledgeSpaceId} />
}
