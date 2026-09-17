import { describe, expect, it } from 'vitest'
import {
  deletionJobs,
  logicalDocuments,
  queryImages,
  researchTasks,
  sourceWorkflows,
} from './generated/api/service/orpc.gen'
import {
  zKnowledgeFsDocumentReindexResponse,
  zKnowledgeFsQueryAdmissionResponse,
  zPostKnowledgeFsSpacesByControlSpaceIdDeletionJobsByJobIdRetryHeaders,
} from './generated/api/service/zod.gen'

describe('generated KnowledgeFS Service recovery contract', () => {
  it('exposes resource discovery and durable recovery routes', () => {
    expect(logicalDocuments.get).toBeDefined()
    expect(logicalDocuments.byDocumentId.get).toBeDefined()
    expect(logicalDocuments.byDocumentId.processingTasks.get).toBeDefined()
    expect(deletionJobs.byJobId.get).toBeDefined()
    expect(deletionJobs.byJobId.retry.post).toBeDefined()
    expect(researchTasks.byTaskId.resume.post).toBeDefined()
    expect(sourceWorkflows.get).toBeDefined()
    expect(queryImages.post).toBeDefined()
    expect(
      zPostKnowledgeFsSpacesByControlSpaceIdDeletionJobsByJobIdRetryHeaders.safeParse({}).success,
    ).toBe(false)
  })

  it('requires the public trace identifier for admitted streams', () => {
    const admission = {
      expires_at: '2026-09-17T00:00:00Z',
      operation_id: 'createQuery',
      request: { knowledgeSpaceId: 'space-1', query: 'hello' },
      token: 'capability',
      url: '/v1/knowledge-fs/query-stream',
    }
    expect(zKnowledgeFsQueryAdmissionResponse.safeParse(admission).success).toBe(false)
    expect(
      zKnowledgeFsQueryAdmissionResponse.safeParse({ ...admission, trace_id: 'trace-1' }).success,
    ).toBe(true)
  })

  it('retains durable reindex admission pending results', () => {
    expect(
      zKnowledgeFsDocumentReindexResponse.parse({
        bulk_job_id: 'batch-1',
        items: [{ document_id: 'document-1', status: 'pending' }],
        total: 1,
      }).items[0]?.status,
    ).toBe('pending')
  })
})
