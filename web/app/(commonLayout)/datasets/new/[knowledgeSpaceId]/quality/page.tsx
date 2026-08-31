import { QualityPage } from '@/features/new-rag/quality/page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params
  return <QualityPage knowledgeSpaceId={knowledgeSpaceId} />
}
