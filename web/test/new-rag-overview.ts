import type {
  KnowledgeFsBackgroundTaskResponse,
  KnowledgeFsOverviewActivityResponse,
  KnowledgeFsOverviewAttentionListResponse,
  KnowledgeFsOverviewInventoryResponse,
  KnowledgeFsOverviewQueryOutcomesResponse,
  KnowledgeFsOverviewStatsResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

type OverviewResponses = {
  activity: { data: KnowledgeFsOverviewActivityResponse[]; next_cursor: null }
  attention: KnowledgeFsOverviewAttentionListResponse
  inventory: KnowledgeFsOverviewInventoryResponse
  outcomes: KnowledgeFsOverviewQueryOutcomesResponse
  stats: KnowledgeFsOverviewStatsResponse
  tasks: KnowledgeFsBackgroundTaskResponse[]
  source: { name: string }
}

/** Fresh response presets; no providers, hooks or shared mutation on import. */
export const createOverviewData = (): OverviewResponses => ({
  activity: {
    data: [
      {
        action: 'source.synced',
        actor: { id: 'dify-account:member-1', type: 'member' },
        details: { count: 1 },
        id: 'activity-1',
        occurred_at: '2026-07-29T08:05:00Z',
        resource: { id: 'source-1', type: 'source' },
        result: 'success',
      },
    ],
    next_cursor: null,
  },
  attention: { data: [] },
  inventory: {
    generated_at: '2026-07-29T09:00:00Z',
    graph_entities: { added_last_7d: 1, total: 12 },
    graph_relations: { added_last_7d: 2, total: 18 },
    index_coverage: { indexed: 4, percentage: 80, total: 5 },
    knowledge_space_id: 'knowledge-1',
    source_categories: { crawl: 1, online_documents: 1, online_drives: 0, uploads: 1 },
  },
  outcomes: {
    buckets: [],
    current: {
      answer_rate: 0.84,
      answered: 8,
      low_confidence: 1,
      no_evidence: 1,
      query_count: 10,
    },
    generated_at: '2026-07-29T09:00:00Z',
    knowledge_space_id: 'knowledge-1',
    previous: {
      answer_rate: 0.8,
      answered: 4,
      low_confidence: 1,
      no_evidence: 0,
      query_count: 5,
    },
    previous_since: '2026-07-27T09:00:00Z',
    since: '2026-07-28T09:00:00Z',
    window: '24h',
  },
  source: {
    name: 'Notion — Support SOP',
  },
  stats: {
    answer_rate: { change_percentage_points: 4, previous_value: 0.8, value: 0.84 },
    documents: 5,
    fresh_source_count: 3,
    freshness_seconds: 18000,
    generated_at: '2026-07-29T09:00:00Z',
    knowledge_space_id: 'knowledge-1',
    linked_apps: 2,
    queries: { change_rate: 1, previous_value: 5, value: 10 },
    source_count: 3,
    stale_source_count: 0,
    window: '24h',
  },
  tasks: [
    {
      can_cancel: false,
      can_retry: false,
      completed_at: '2026-07-29T08:05:00Z',
      created_at: '2026-07-29T08:00:00Z',
      id: 'task-1',
      knowledge_space_id: 'knowledge-1',
      operation: 'source_sync',
      progress_completed: 1,
      progress_failed: 0,
      progress_percent: 100,
      progress_total: 1,
      source_id: undefined,
      state: 'completed',
      task_kind: 'source',
      updated_at: '2026-07-29T08:05:00Z',
    },
  ],
})

export function createOverviewTask(state: KnowledgeFsBackgroundTaskResponse['state']) {
  return {
    ...createOverviewData().tasks[0]!,
    task_kind: 'document',
    id: 'task-1',
    knowledge_space_id: 'space-a',
    document_id: 'document-1',
    can_cancel: state === 'running',
    can_retry: state === 'failed',
    completed_at: state === 'completed' ? '2026-09-08T00:00:01Z' : undefined,
    progress_completed: state === 'completed' ? 1 : 0,
    progress_percent: state === 'completed' ? 100 : 20,
    operation: 'document_processing',
    progress_failed: state === 'failed' ? 1 : 0,
    state,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: state === 'running' ? '2026-09-08T00:00:00Z' : '2026-09-08T00:00:01Z',
  } satisfies KnowledgeFsBackgroundTaskResponse
}

export function createOverviewActivity(id: string, count: number) {
  return {
    ...createOverviewData().activity.data[0]!,
    action: 'source.synced',
    result: 'success',
    resource: { id: 'source-1', type: 'source' },
    id,
    actor: { id: 'system', type: 'system' },
    details: { count, reasonCode: `Synced ${count} documents` },
    occurred_at: '2026-09-08T00:00:00Z',
  } satisfies KnowledgeFsOverviewActivityResponse
}
