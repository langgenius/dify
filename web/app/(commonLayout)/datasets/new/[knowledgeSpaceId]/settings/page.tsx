import { KnowledgeSettingsPage } from '@/features/new-rag/settings/page'

export default async function Page({ params }: { params: Promise<{ knowledgeSpaceId: string }> }) {
  const { knowledgeSpaceId } = await params

  return <KnowledgeSettingsPage knowledgeSpaceId={knowledgeSpaceId} />
}
