import { AddSourcePage } from '@/features/new-rag/add-source-page'
import { singleSearchParam } from '@/features/new-rag/routes'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ knowledgeSpaceId: string }>
  searchParams: Promise<{
    draft?: string | string[]
    type?: string | string[]
  }>
}) {
  const { knowledgeSpaceId } = await params
  const { draft, type } = await searchParams

  return (
    <AddSourcePage
      initialSourceType={singleSearchParam(type)}
      knowledgeSpaceId={knowledgeSpaceId}
      sourceDraftKey={singleSearchParam(draft)}
    />
  )
}
