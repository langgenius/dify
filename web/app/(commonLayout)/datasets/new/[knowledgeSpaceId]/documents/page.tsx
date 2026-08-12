import { DocumentsPage } from '@/features/new-rag/documents-page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <DocumentsPage knowledgeSpaceId={knowledgeSpaceId} />
}
