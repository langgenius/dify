import type {
  HitTestingRecord,
  HitTestingSegment,
} from '@dify/contracts/api/console/datasets/types.gen'

type HitTestingSegmentOverrides = Partial<Omit<HitTestingSegment, 'document'>> & {
  document?: Partial<HitTestingSegment['document']>
}

const createHitTestingSegmentFixture = ({
  document,
  ...overrides
}: HitTestingSegmentOverrides = {}): HitTestingSegment => ({
  id: 'segment-1',
  position: 1,
  document_id: 'document-1',
  content: 'Original content',
  sign_content: '',
  answer: '',
  word_count: 100,
  tokens: 20,
  keywords: [],
  index_node_id: null,
  index_node_hash: 'hash-1',
  hit_count: 1,
  enabled: true,
  disabled_at: null,
  disabled_by: null,
  status: 'completed',
  created_by: 'user-1',
  created_at: 1710000000,
  indexing_at: null,
  completed_at: null,
  error: null,
  stopped_at: null,
  ...overrides,
  document: {
    id: 'document-1',
    name: 'file.pdf',
    data_source_type: 'upload_file',
    doc_type: 'book',
    doc_metadata: null,
    ...document,
  },
})

export const createHitTestingRecordFixture = ({
  segment,
  ...overrides
}: Partial<Omit<HitTestingRecord, 'segment'>> & {
  segment?: HitTestingSegmentOverrides
} = {}): HitTestingRecord => ({
  score: 0.85,
  tsne_position: null,
  child_chunks: [],
  files: [],
  summary: null,
  ...overrides,
  segment: createHitTestingSegmentFixture(segment),
})
