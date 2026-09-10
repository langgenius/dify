import { DocumentDetailPage } from '@/features/new-rag/document-detail-page'

export default async function Page({
  params,
}: {
  params: Promise<{ documentId: string; knowledgeSpaceId: string }>
}) {
  const { documentId, knowledgeSpaceId } = await params

  return <DocumentDetailPage documentId={documentId} knowledgeSpaceId={knowledgeSpaceId} />
}
