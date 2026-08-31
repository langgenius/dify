import type {
  KnowledgeFsResearchTaskResponse,
  KnowledgeFsTraceResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  extractRetrievalEvidence,
  formatDuration,
  formatRetrievalDuration,
  formatStageDuration,
  researchTaskIsActive,
  retrievalTestRecords,
  shouldRefreshResearchPartials,
} from '../model'

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
        chunkId: 'node-1',
        documentAssetId: 'document-1',
        documentRevision: 3,
        id: 'node-1',
        revision: '3',
        text: 'Verification marker: OR-KFS-2026-07-28.',
        title: 'OpenRouter chain smoke test',
      }),
    ])
  })

  it('keeps an unavailable evidence tombstone without requiring deleted content', () => {
    expect(
      extractRetrievalEvidence({
        data: [
          {
            kind: 'resource',
            metadata: {
              availability: 'unavailable',
              unavailableReason: 'document-deleted-or-unavailable',
            },
            name: 'node-deleted',
            resourceType: 'node',
            targetId: 'node-deleted',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        availability: 'unavailable',
        chunkId: 'node-deleted',
        text: '',
        unavailableReason: 'document-deleted-or-unavailable',
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
        chunkId: 'node-1',
        documentAssetId: 'asset-1',
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
          duration_ms: 1250,
          id: 'trace-1',
          mode: 'fast',
          query: 'Fast question',
          result_count: 4,
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
    expect(records[1]).toEqual(expect.objectContaining({ durationMs: 1250, resultCount: 4 }))
    expect(researchTaskIsActive({ stage: 'retrieving' } as KnowledgeFsResearchTaskResponse)).toBe(
      true,
    )
  })

  it('maps an unsuccessful historical trace to a failed retrieval record', () => {
    const [record] = retrievalTestRecords(
      [
        {
          completed: false,
          created_at: '2026-07-28T10:00:00.000Z',
          duration_ms: 30_000,
          id: 'trace-failed',
          mode: 'fast',
          profile: {},
          query: 'Why did retrieval fail?',
          result_count: 0,
          scores: {},
          stages: [{ name: 'query.generate', status: 'error' }],
        },
      ],
      [],
    )

    expect(record).toEqual(
      expect.objectContaining({
        durationMs: 30_000,
        id: 'trace-failed',
        status: 'failed',
      }),
    )
  })

  it('formats research durations in seconds and minutes', () => {
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(303_000)).toBe('5m 3s')
  })

  it('keeps non-zero subsecond research stages visible', () => {
    expect(formatStageDuration(7)).toBe('7ms')
    expect(formatStageDuration(21)).toBe('21ms')
    expect(formatStageDuration(0)).toBe('0s')
    expect(formatStageDuration(6_900)).toBe('7s')
  })

  it('formats retrieval latency with millisecond precision below one second', () => {
    expect(formatRetrievalDuration(320)).toBe('320ms')
    expect(formatRetrievalDuration(800)).toBe('800ms')
    expect(formatRetrievalDuration(1_200)).toBe('1.2s')
    expect(formatRetrievalDuration(2_100)).toBe('2.1s')
  })

  it('localizes duration units for the active language', () => {
    expect(formatDuration(303_000, 'zh-CN')).toBe('5分钟 3秒')
    expect(formatRetrievalDuration(1_200, 'zh-CN')).toBe('1.2秒')
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
