import type {
  KnowledgeFsResearchTaskResponse,
  KnowledgeFsTraceResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  extractRetrievalEvidence,
  formatDuration,
  researchTaskIsActive,
  retrievalTestRecords,
  shouldRefreshResearchPartials,
} from '../retrieval-test-model'

describe('retrieval test model', () => {
  it('normalizes trace evidence metadata and keeps the score readable', () => {
    expect(
      extractRetrievalEvidence({
        data: [
          {
            kind: 'resource',
            metadata: {
              document_name: 'handbook.pdf',
              page_number: 8,
              score: 0.89,
              text: 'Refunds are available within thirty days.',
            },
            name: 'Refund policy',
            target_id: 'document-1',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        documentId: 'document-1',
        documentName: 'handbook.pdf',
        page: 8,
        score: 0.89,
        text: 'Refunds are available within thirty days.',
        title: 'Refund policy',
      }),
    ])
  })

  it('keeps the cited document id when a KnowledgeFS evidence entry targets a node', () => {
    expect(
      extractRetrievalEvidence({
        items: [
          {
            kind: 'resource',
            metadata: {
              documentId: 'document-1',
              documentVersion: 3,
              score: 0.89,
              text: 'Verification marker: OR-KFS-2026-07-28.',
              title: 'OpenRouter chain smoke test',
            },
            name: 'node-1',
            resourceType: 'node',
            targetId: 'node-1',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        documentId: 'document-1',
        id: 'node-1',
        revision: '3',
        text: 'Verification marker: OR-KFS-2026-07-28.',
        title: 'OpenRouter chain smoke test',
      }),
    ])
  })

  it('walks nested research evidence bundles and deduplicates repeated chunks', () => {
    const evidence = extractRetrievalEvidence({
      data: [
        {
          evidence_bundle: {
            groups: [
              {
                chunks: [
                  { id: 'chunk-1', score: 0.77, text: 'Nested evidence', title: 'Chunk 1' },
                  { id: 'chunk-1', score: 0.77, text: 'Nested evidence', title: 'Chunk 1' },
                ],
              },
            ],
          },
          sequence: 1,
        },
      ],
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toEqual(expect.objectContaining({ id: 'chunk-1', score: 0.77 }))
  })

  it('keeps document references carried by research citations', () => {
    expect(
      extractRetrievalEvidence({
        data: [
          {
            evidence_bundle: {
              items: [
                {
                  citations: [
                    {
                      documentAssetId: 'asset-1',
                      documentVersion: 2,
                    },
                  ],
                  nodeId: 'node-1',
                  score: 0.45,
                  text: 'Research evidence with a durable document citation.',
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        documentId: 'asset-1',
        revision: 'Revision 2',
        score: 0.45,
      }),
    ])
  })

  it('merges trace and research histories newest-first', () => {
    const records = retrievalTestRecords(
      [
        {
          completed: true,
          created_at: '2026-07-28T10:00:00.000Z',
          id: 'trace-1',
          mode: 'fast',
          query: 'Fast question',
        } as KnowledgeFsTraceResponse,
      ],
      [
        {
          cost: {},
          created_at: 1_800_000_000,
          id: 'research-1',
          knowledge_space_id: 'space-1',
          metadata: {},
          query: 'Research question',
          stage: 'retrieving',
          updated_at: 1_800_000_010,
        } as KnowledgeFsResearchTaskResponse,
      ],
    )

    expect(records.map((record) => record.id)).toEqual(['research-1', 'trace-1'])
    expect(records[0]).toEqual(expect.objectContaining({ status: 'running' }))
    expect(researchTaskIsActive({ stage: 'retrieving' } as KnowledgeFsResearchTaskResponse)).toBe(
      true,
    )
  })

  it('formats research durations in seconds and minutes', () => {
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(303_000)).toBe('5min 3s')
  })

  it('refreshes partials when an active research task becomes completed', () => {
    const activeTask = {
      id: 'research-1',
      stage: 'generating',
    } as KnowledgeFsResearchTaskResponse
    const completedTask = {
      id: 'research-1',
      stage: 'completed',
    } as KnowledgeFsResearchTaskResponse

    expect(shouldRefreshResearchPartials(activeTask, completedTask)).toBe(true)
    expect(shouldRefreshResearchPartials(completedTask, completedTask)).toBe(false)
    expect(shouldRefreshResearchPartials(undefined, completedTask)).toBe(false)
    expect(
      shouldRefreshResearchPartials(activeTask, {
        ...completedTask,
        id: 'research-2',
      }),
    ).toBe(false)
  })
})
