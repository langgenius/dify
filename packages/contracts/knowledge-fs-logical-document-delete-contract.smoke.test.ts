import { describe, expect, it } from 'vitest'
import { logicalDocuments } from './generated/api/console/knowledge-fs/orpc.gen'
import {
  zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdBody,
  zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdHeaders,
  zKnowledgeFsDocumentDeletePayload,
} from './generated/api/console/knowledge-fs/zod.gen'

describe('generated KnowledgeFS logical document deletion contract', () => {
  it('exposes logical document deletion with revision and idempotency guards', () => {
    expect(logicalDocuments.byDocumentId.delete).toBeDefined()
    expect(
      zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdBody.safeParse({
        expectedRevision: 1,
      }).success,
    ).toBe(true)
    expect(
      zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdBody.safeParse({
        expectedRevision: 0,
      }).success,
    ).toBe(true)
    expect(
      zKnowledgeFsDocumentDeletePayload.safeParse({
        expectedRevision: 0,
      }).success,
    ).toBe(false)
    expect(
      zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdHeaders.safeParse({
        'Idempotency-Key': 'short-1',
      }).success,
    ).toBe(false)
    expect(
      zDeleteKnowledgeFsSpacesByControlSpaceIdLogicalDocumentsByDocumentIdHeaders.safeParse({
        'Idempotency-Key': 'logical-delete-1',
      }).success,
    ).toBe(true)
  })
})
