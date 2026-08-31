import type { DocumentDisplayStatus } from '../../model'
import type { LogicalDocument } from '../../models'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { useDocumentBulkSelection } from '../selection-state'

function document(id: string, overrides: Partial<LogicalDocument> = {}): LogicalDocument {
  return {
    active: {
      activatedAt: '2026-07-20T10:00:00Z',
      contentHash: `hash-${id}`,
      createdAt: '2026-07-20T09:00:00Z',
      documentAssetId: `asset-${id}`,
      documentAssetVersion: 1,
      documentId: id,
      knowledgeSpaceId: 'space-1',
      mimeType: 'text/plain',
      revision: 1,
      sizeBytes: 10,
      state: 'active',
    },
    activeRevision: 1,
    createdAt: '2026-07-20T09:00:00Z',
    enabled: true,
    id,
    knowledgeSpaceId: 'space-1',
    rowVersion: 1,
    status: 'ready',
    title: `${id}.txt`,
    updatedAt: '2026-07-20T10:00:00Z',
    userMetadata: {},
    ...overrides,
  }
}

function statuses(entries: Array<[string, DocumentDisplayStatus]>) {
  return new Map(entries)
}

describe('useDocumentBulkSelection', () => {
  it('selects filtered rows and projects stale ids out after results refresh', () => {
    const first = document('document-1')
    const second = document('document-2')
    const { result, rerender } = renderHook(
      ({ documents, filteredDocuments }) =>
        useDocumentBulkSelection({
          canSelect: true,
          documents,
          filteredDocuments,
          statuses: statuses([
            ['document-1', 'ready'],
            ['document-2', 'ready'],
          ]),
          taskResultsIncomplete: false,
        }),
      { initialProps: { documents: [first, second], filteredDocuments: [first] } },
    )

    act(() => result.current.toggleAllFiltered())
    expect(result.current.selectedDocumentIds).toEqual(new Set(['document-1']))
    expect(result.current.allFilteredSelected).toBe(true)

    rerender({ documents: [second], filteredDocuments: [second] })
    expect(result.current.selectedDocumentIds.size).toBe(0)
    expect(result.current.someFilteredSelected).toBe(false)
  })

  it('enforces the 100-document transaction limit in the shared selection snapshot', () => {
    const documents = Array.from({ length: 101 }, (_, index) => document(`document-${index}`))
    const { result } = renderHook(() =>
      useDocumentBulkSelection({
        canSelect: true,
        documents,
        filteredDocuments: documents,
        statuses: statuses(documents.map((item) => [item.id, 'ready'])),
        taskResultsIncomplete: false,
      }),
    )

    act(() => result.current.toggleAllFiltered())

    expect(result.current.selectedDocumentIds.size).toBe(101)
    expect(result.current.selectionInvalid).toBe(true)
    expect(result.current.downloadableDocumentIds).toEqual([])
    expect(result.current.availabilityDisabled).toBe(true)
  })

  it('derives one consistent action snapshot from document statuses', () => {
    const ready = document('ready')
    const processing = document('processing')
    const failed = document('failed', { active: null, status: 'failed' })
    const documents = [ready, processing, failed]
    const { result } = renderHook(() =>
      useDocumentBulkSelection({
        canSelect: true,
        documents,
        filteredDocuments: documents,
        statuses: statuses([
          ['ready', 'ready'],
          ['processing', 'processing'],
          ['failed', 'failed'],
        ]),
        taskResultsIncomplete: false,
      }),
    )

    act(() => result.current.toggle('ready'))
    expect(result.current.downloadableDocumentIds).toEqual(['ready'])
    expect(result.current.reindexDisabled).toBe(false)

    act(() => result.current.toggle('processing'))
    expect(result.current.downloadableDocumentIds).toEqual([])
    expect(result.current.reindexDisabled).toBe(true)

    act(() => result.current.toggle('failed'))
    expect(result.current.availabilityActionVisible).toBe(false)
    expect(result.current.availabilityDisabled).toBe(true)
  })

  it('ignores checkbox intents while result completeness disables selection', () => {
    const item = document('document-1')
    const { result } = renderHook(() =>
      useDocumentBulkSelection({
        canSelect: false,
        documents: [item],
        filteredDocuments: [item],
        statuses: statuses([['document-1', 'ready']]),
        taskResultsIncomplete: false,
      }),
    )

    act(() => {
      result.current.toggle('document-1')
      result.current.toggleAllFiltered()
    })

    expect(result.current.selectedDocumentIds.size).toBe(0)
  })
})
