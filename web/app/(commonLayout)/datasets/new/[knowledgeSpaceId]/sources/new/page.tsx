import type { NewKnowledgeSourceDraft } from '@/features/new-rag/routes'
import { AddSourcePage } from '@/features/new-rag/add-source-page'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ knowledgeSpaceId: string }>
  searchParams: Promise<{
    includeSubpages?: string
    maxPages?: string
    provider?: string
    rootUrl?: string
    sourceName?: string
    type?: string
  }>
}) {
  const { knowledgeSpaceId } = await params
  const { includeSubpages, maxPages, provider, rootUrl, sourceName, type } = await searchParams
  const parsedMaxPages = Number(maxPages)
  const initialSourceDraft: NewKnowledgeSourceDraft | undefined =
    provider || rootUrl || sourceName || includeSubpages || maxPages
      ? {
          includeSubpages: includeSubpages !== 'false',
          maxPages:
            Number.isInteger(parsedMaxPages) && parsedMaxPages > 0 && parsedMaxPages <= 200
              ? parsedMaxPages
              : 100,
          provider: provider || 'Firecrawl',
          rootUrl: rootUrl || '',
          sourceName: sourceName || '',
        }
      : undefined

  return (
    <AddSourcePage
      initialSourceDraft={initialSourceDraft}
      initialSourceType={type}
      knowledgeSpaceId={knowledgeSpaceId}
    />
  )
}
