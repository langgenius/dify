import { describe, expect, it } from 'vite-plus/test'
import { isProcessMode, toSegmentationRules } from '../process-rule'

describe('toSegmentationRules', () => {
  it('should restore stored segmentation with the backend defaults', () => {
    expect(
      toSegmentationRules({
        pre_processing_rules: [
          { id: 'remove_extra_spaces', enabled: true },
          { id: 'legacy_rule', enabled: true },
        ],
        segmentation: { max_tokens: 500 },
        parent_mode: 'paragraph',
        subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 10 },
      }),
    ).toEqual({
      pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
      segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 0 },
      parent_mode: 'paragraph',
      subchunk_segmentation: { separator: '\n', max_tokens: 200, chunk_overlap: 10 },
    })
  })

  it('should restore nothing for automatic rules without segmentation', () => {
    expect(toSegmentationRules({ pre_processing_rules: null })).toBeUndefined()
  })
})

describe('isProcessMode', () => {
  it('should accept only the editable process modes', () => {
    expect(isProcessMode('custom')).toBe(true)
    expect(isProcessMode('hierarchical')).toBe(true)
    expect(isProcessMode('automatic')).toBe(false)
  })
})
