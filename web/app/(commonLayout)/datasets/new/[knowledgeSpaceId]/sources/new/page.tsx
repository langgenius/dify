import { AddSourcePage } from '@/features/new-rag/add-source-page'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ knowledgeSpaceId: string }>
  searchParams: Promise<{ type?: string }>
}) {
  const { knowledgeSpaceId } = await params
  const { type } = await searchParams

  return <AddSourcePage initialSourceType={type} knowledgeSpaceId={knowledgeSpaceId} />
}
