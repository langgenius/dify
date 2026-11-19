import type { CitationItem } from '../../type'

export const citation = (overrides: Partial<CitationItem> = {}): CitationItem => ({
  document_id: 'doc-1',
  document_name: 'Document One',
  data_source_type: 'upload_file',
  segment_id: 'seg-1',
  content: 'Evidence passage',
  dataset_id: 'dataset-1',
  dataset_name: 'Dataset One',
  segment_position: 1,
  word_count: 55,
  hit_count: 5,
  index_node_hash: 'abc123',
  score: 0.3,
  ...overrides,
})
