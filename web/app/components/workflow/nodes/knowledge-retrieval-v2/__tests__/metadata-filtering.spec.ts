import { MetadataFilteringVariableType } from '../../knowledge-retrieval/types'
import { intersectKnowledgeFsMetadataFields } from '../metadata-filtering'

const field = (name: string, type: 'number' | 'string' | 'time', id = name) => ({
  count: 1,
  createdAt: '2026-08-18T00:00:00.000Z',
  id,
  name,
  rowVersion: 1,
  type,
  updatedAt: '2026-08-18T00:00:00.000Z',
})

describe('intersectKnowledgeFsMetadataFields', () => {
  it('keeps only same-name, same-type fields shared by all selected spaces', () => {
    expect(
      intersectKnowledgeFsMetadataFields([
        [field('department', 'string', 'field-a'), field('priority', 'number')],
        [field('department', 'string', 'field-b'), field('priority', 'string')],
      ]),
    ).toEqual([
      {
        id: 'knowledge-fs:string:department',
        name: 'department',
        type: MetadataFilteringVariableType.string,
        value: 'department',
      },
    ])
  })

  it('returns no fields until at least one selected space has loaded', () => {
    expect(intersectKnowledgeFsMetadataFields([])).toEqual([])
  })

  it('maps every KnowledgeFS metadata type when one selected space supplies the catalog', () => {
    expect(
      intersectKnowledgeFsMetadataFields([
        [field('department', 'string'), field('priority', 'number'), field('reviewed_at', 'time')],
      ]),
    ).toEqual([
      expect.objectContaining({ name: 'department', type: MetadataFilteringVariableType.string }),
      expect.objectContaining({ name: 'priority', type: MetadataFilteringVariableType.number }),
      expect.objectContaining({ name: 'reviewed_at', type: MetadataFilteringVariableType.time }),
    ])
  })
})
