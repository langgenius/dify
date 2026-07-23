import type { DocumentAsset } from '@dify/contracts/knowledge-fs/types.gen'
// oxlint-disable-next-line no-restricted-imports
import { post } from '@/service/base'

export function uploadKnowledgeDocument({
  file,
  knowledgeSpaceId,
}: {
  file: File
  knowledgeSpaceId: string
}) {
  const body = new FormData()
  body.append('file', file)
  return post<DocumentAsset>(
    `/knowledge-fs/knowledge-spaces/${knowledgeSpaceId}/documents`,
    { body },
    { bodyStringify: false, deleteContentType: true },
  )
}
