import { consoleClient } from '@/service/client'

type LogicalDocumentCitation = {
  documentId: string
  revision: number
}

export async function resolveLogicalDocumentCitation({
  documentAssetId,
  documentVersion,
  knowledgeSpaceId,
}: {
  documentAssetId: string
  documentVersion?: number
  knowledgeSpaceId: string
}): Promise<LogicalDocumentCitation | undefined> {
  if (documentVersion === undefined) return undefined

  const citation =
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.documentReferences.resolve.get({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        document_asset_id: documentAssetId,
        document_asset_version: documentVersion,
      },
    })

  return {
    documentId: citation.document_id,
    revision: citation.revision,
  }
}
