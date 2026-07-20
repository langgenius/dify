import type {
  DocumentProcessingTask,
  LogicalDocument,
} from '@dify/contracts/knowledge-fs/types.gen'
import {
  documentDisplayStatus,
  newestTaskByDocument,
  taskCanRetry,
  taskIsActive,
  taskNeedsAttention,
} from '../document-model'

const document = (overrides: Partial<LogicalDocument> = {}): LogicalDocument => ({
  active: {
    contentHash: 'hash',
    createdAt: '2026-07-20T10:00:00Z',
    documentAssetId: 'asset-1',
    documentAssetVersion: 1,
    documentId: 'document-1',
    knowledgeSpaceId: 'space-1',
    mimeType: 'text/plain',
    revision: 2,
    sizeBytes: 10,
    state: 'active',
  },
  activeRevision: 2,
  createdAt: '2026-07-20T10:00:00Z',
  id: 'document-1',
  knowledgeSpaceId: 'space-1',
  rowVersion: 1,
  status: 'ready',
  title: 'Document',
  updatedAt: '2026-07-20T10:00:00Z',
  userMetadata: {},
  ...overrides,
})

const task = (overrides: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask => ({
  createdAt: '2026-07-20T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 3,
  id: 'task-1',
  knowledgeSpaceId: 'space-1',
  progressPercent: 10,
  stage: 'queued',
  state: 'queued',
  updatedAt: '2026-07-20T10:00:00Z',
  ...overrides,
})

describe('new Knowledge document model', () => {
  it('chooses the highest revision before a more recently updated stale task', () => {
    const result = newestTaskByDocument([
      task({ documentRevision: 2, id: 'stale', updatedAt: '2026-07-20T10:10:00Z' }),
      task({ documentRevision: 3, id: 'current', updatedAt: '2026-07-20T10:01:00Z' }),
    ])

    expect(result.get('document-1')?.id).toBe('current')
  })

  it.each([
    ['dispatch_pending', 'queued'],
    ['queued', 'queued'],
    ['retry_wait', 'queued'],
    ['running', 'processing'],
    ['failed', 'failed'],
  ] as const)('maps a latest %s task to %s', (state, expected) => {
    expect(documentDisplayStatus(document(), task({ state }))).toBe(expected)
  })

  it('keeps a last ready revision available after a canceled re-index', () => {
    expect(documentDisplayStatus(document(), task({ state: 'canceled' }))).toBe('ready')
    expect(
      documentDisplayStatus(
        document({ active: null, activeRevision: undefined, status: 'pending' }),
        task({ state: 'canceled' }),
      ),
    ).toBe('failed')
  })

  it('does not let an older failed task override the active revision', () => {
    expect(documentDisplayStatus(document(), task({ documentRevision: 1, state: 'failed' }))).toBe(
      'ready',
    )
  })

  it('maps a disabled source and deleting lifecycle to the designed disabled state', () => {
    expect(documentDisplayStatus(document(), undefined, true)).toBe('disabled')
    expect(documentDisplayStatus(document({ status: 'deleting' }))).toBe('disabled')
  })

  it('keeps task badge and actions aligned with the contract states', () => {
    expect(taskIsActive(task({ state: 'running' }))).toBe(true)
    expect(taskNeedsAttention(task({ state: 'failed' }))).toBe(true)
    expect(taskCanRetry(task({ state: 'canceled' }))).toBe(false)
    expect(taskNeedsAttention(task({ state: 'succeeded' }))).toBe(false)
    expect(taskCanRetry(task({ state: 'superseded' }))).toBe(false)
  })
})
