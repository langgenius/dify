import { describe, expect, it } from 'vitest'
import { logicalDocuments } from './generated/api/console/knowledge-fs/orpc.gen'
import {
  zGetKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdDownloadResponse,
  zPostKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsDownloadZipBody,
  zPostKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsDownloadZipResponse,
} from './generated/api/console/knowledge-fs/zod.gen'

describe('generated KnowledgeFS document download contract', () => {
  it('exposes single and batch binary downloads', () => {
    expect(logicalDocuments.byDocumentId.download.get).toBeDefined()
    expect(logicalDocuments.downloadZip.post).toBeDefined()
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsDownloadZipBody.safeParse({
        document_ids: ['document-1', 'document-2'],
      }).success,
    ).toBe(true)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsDownloadZipBody.safeParse({
        document_ids: [],
      }).success,
    ).toBe(false)

    const binary = new Blob(['document'])
    expect(
      zGetKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdDownloadResponse.safeParse(
        binary,
      ).success,
    ).toBe(true)
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsDownloadZipResponse.safeParse(binary)
        .success,
    ).toBe(true)
  })
})
