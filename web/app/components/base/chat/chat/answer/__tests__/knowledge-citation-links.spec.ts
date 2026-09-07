import type { CitationItem } from '../../type'
import { describe, expect, it } from 'vite-plus/test'
import { resolveKnowledgeCitationLinks } from '../knowledge-citation-links'

describe('trusted KnowledgeFS citation links', () => {
  const id = `kfs_${'a'.repeat(32)}`
  const source: CitationItem = {
    content: '',
    data_source_type: 'knowledge_fs',
    dataset_name: 'Docs',
    dataset_id: 'space',
    document_id: 'doc',
    document_name: 'Manual',
    index_node_hash: '',
    segment_id: 'node',
    segment_position: 1,
    hit_count: 0,
    score: 0,
    word_count: 0,
    knowledge_fs_citation: {
      id,
      control_space_id: '00000000-0000-4000-8000-000000000001',
      space_name: 'Docs',
      node_id: 'node',
      document_asset_id: 'doc',
      artifact_hash: 'hash',
    },
  }
  it('links only an authenticated receipt and retains the label', () => {
    expect(resolveKnowledgeCitationLinks(`[手册](kfs://${id})`, [source])).toBe(`[手册](#${id})`)
  })
  it('renders forged or missing receipts as text without granting navigation', () => {
    expect(resolveKnowledgeCitationLinks(`[手册](kfs://${id})`)).toBe('手册')
    expect(resolveKnowledgeCitationLinks(`[手册](kfs://kfs_${'b'.repeat(32)})`, [source])).toBe(
      '手册',
    )
  })
  it('does not reinterpret normal links', () => {
    expect(resolveKnowledgeCitationLinks('[site](https://example.test)', [source])).toBe(
      '[site](https://example.test)',
    )
  })
})
