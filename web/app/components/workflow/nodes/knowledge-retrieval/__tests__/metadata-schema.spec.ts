import type { MetadataInDoc } from '@/models/datasets'
import {
  getMetadataConflicts,
  getSharedMetadata,
  isMetadataConditionCompatible,
} from '../metadata-schema'
import { ComparisonOperator } from '../types'

const field = (
  id: string,
  type: MetadataInDoc['type'] = 'string',
  name = 'category',
): MetadataInDoc => ({ id, type, name, value: '' })

describe('Knowledge metadata schema', () => {
  it('matches names and types across dataset-local IDs', () => {
    expect(
      getSharedMetadata([{ doc_metadata: [field('a')] }, { doc_metadata: [field('b')] }]),
    ).toEqual([field('a')])
    expect(
      isMetadataConditionCompatible(
        { id: 'c', metadata_id: 'b', name: 'category', comparison_operator: ComparisonOperator.is },
        [field('a')],
      ),
    ).toBe(true)
  })

  it('includes missing and empty schemas in the strict intersection', () => {
    expect(getSharedMetadata([{ doc_metadata: [field('a')] }, {}])).toEqual([])
    expect(getSharedMetadata([{ doc_metadata: [field('a')] }, { doc_metadata: [] }])).toEqual([])
    expect(getSharedMetadata([])).toEqual([])
  })

  it('excludes conflicting types and names and reports each field once', () => {
    const datasets = [
      { doc_metadata: [field('a'), field('x', 'number', 'score')] },
      { doc_metadata: [field('b', 'number')] },
    ]
    expect(getSharedMetadata(datasets)).toEqual([])
    expect(getMetadataConflicts(datasets)).toEqual(['category', 'score'])
  })

  it('preserves constants and dynamic expressions when assessing conflicts', () => {
    const condition = {
      id: 'c',
      name: 'category',
      type: 'string' as const,
      comparison_operator: ComparisonOperator.is,
      value: '{{#start.category#}}',
    }
    expect(isMetadataConditionCompatible(condition, [field('a', 'number')])).toBe(false)
    expect(condition.value).toBe('{{#start.category#}}')
    expect(
      isMetadataConditionCompatible(
        { ...condition, comparison_operator: ComparisonOperator.empty },
        [field('a', 'number')],
      ),
    ).toBe(false)
    expect(isMetadataConditionCompatible(condition, [field('a')])).toBe(true)
  })

  it('rejects incompatible legacy operators without requiring a recorded type', () => {
    expect(
      isMetadataConditionCompatible(
        { id: 'c', name: 'category', comparison_operator: ComparisonOperator.contains },
        [field('a', 'number')],
      ),
    ).toBe(false)
    expect(
      isMetadataConditionCompatible(
        { id: 'c', name: 'removed', comparison_operator: ComparisonOperator.empty },
        [field('a')],
      ),
    ).toBe(false)
  })
})
