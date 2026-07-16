import { describe, expect, it } from 'vitest'
import { contract } from './generated/knowledge-fs/orpc.gen'
import {
  zGetKnowledgeSpacesByIdDocumentsByDocumentIdMultimodalByItemIdAssetResponse,
  zPostKnowledgeSpacesByIdDocumentsBody,
  zPostKnowledgeSpacesByIdDocumentsBulkBody,
} from './generated/knowledge-fs/zod.gen'

describe('KnowledgeFS generated contract', () => {
  it('publishes every gateway operation', () => {
    expect(Object.keys(contract)).toHaveLength(176)
    expect(contract).toHaveProperty('getSourceProviders')
    expect(contract).toHaveProperty('postKnowledgeSpacesByIdSourceConnections')
    expect(contract).toHaveProperty('postKnowledgeSpacesByIdDocuments')
  })

  it('accepts callable binary upload inputs', () => {
    const blob = new Blob(['content'], { type: 'text/markdown' })
    const file = new File(['content'], 'document.md', { type: 'text/markdown' })

    expect(zPostKnowledgeSpacesByIdDocumentsBody.safeParse({ file: blob }).success).toBe(true)
    expect(zPostKnowledgeSpacesByIdDocumentsBody.safeParse({ file }).success).toBe(true)
    expect(zPostKnowledgeSpacesByIdDocumentsBulkBody.safeParse({ files: [file] }).success).toBe(
      true,
    )
    expect(zPostKnowledgeSpacesByIdDocumentsBulkBody.safeParse({ files: [] }).success).toBe(false)
    expect(zPostKnowledgeSpacesByIdDocumentsBody.safeParse({ file: 'not-binary' }).success).toBe(
      false,
    )
    expect(
      zPostKnowledgeSpacesByIdDocumentsBulkBody.safeParse({ files: ['not-binary'] }).success,
    ).toBe(false)
    expect(
      zPostKnowledgeSpacesByIdDocumentsBody.safeParse({ documentId: 'invalid', file }).success,
    ).toBe(false)
    expect(
      zGetKnowledgeSpacesByIdDocumentsByDocumentIdMultimodalByItemIdAssetResponse.safeParse(blob)
        .success,
    ).toBe(true)
  })
})
