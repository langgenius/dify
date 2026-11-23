import type { KnowledgeFsTidyFindingResponse as TidyFinding } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { fileTypeLabel, groupDuplicates, mergePlan, newestDocument, relativeTime } from '../review'

const evidence = (documentId: string) => ({
  documentId,
  revision: 1,
  title: `Doc ${documentId}`,
  chunkId: `c-${documentId}`,
  start: 0,
  end: 10,
  text: 'same text',
})
const duplicate = (id: string, left: string, right: string): TidyFinding => ({
  id,
  kind: 'duplicate',
  left: evidence(left),
  right: evidence(right),
  reason: 'identical_content_hash',
  similarity: 1,
  status: 'open',
  revision: 1,
  actionId: null,
  createdAt: '2026-11-01T00:00:00Z',
})

describe('Tidy review helpers', () => {
  it('groups copies of the same document, largest group first', () => {
    const groups = groupDuplicates([
      duplicate('f1', 'a', 'b'),
      duplicate('f2', 'x', 'y'),
      duplicate('f3', 'c', 'b'),
      duplicate('f4', 'a', 'c'),
    ])
    expect(
      groups.map((group) => [group.documentIds.sort(), group.findings.map((f) => f.id)]),
    ).toEqual([
      [
        ['a', 'b', 'c'],
        ['f1', 'f3', 'f4'],
      ],
      [['x', 'y'], ['f2']],
    ])
  })

  it('disables every other copy exactly once and marks the remaining findings reviewed', () => {
    // b–c is reached only through b: a finding order that defeats a greedy pass.
    const [group] = groupDuplicates([duplicate('f1', 'b', 'c'), duplicate('f2', 'a', 'b')])
    const plan = mergePlan(group!, 'a')
    expect(plan.map((step) => [step.finding.id, step.action, step.documentId])).toEqual([
      ['f2', 'disable_document', 'b'],
      ['f1', 'disable_document', 'c'],
    ])
    const [triangle] = groupDuplicates([
      duplicate('f1', 'a', 'b'),
      duplicate('f2', 'b', 'c'),
      duplicate('f3', 'a', 'c'),
    ])
    expect(mergePlan(triangle!, 'b').map((step) => [step.action, step.documentId ?? null])).toEqual(
      [
        ['disable_document', 'a'],
        ['disable_document', 'c'],
        ['review', null],
      ],
    )
  })

  it('picks the newest copy and labels file types', () => {
    const card = (publishedAt: string) => ({
      title: 't',
      mimeType: 'text/html',
      sizeBytes: 1,
      publishedAt,
      enabled: true,
    })
    expect(
      newestDocument(['a', 'b'], {
        a: card('2026-01-01T00:00:00Z'),
        b: card('2026-05-01T00:00:00Z'),
      }),
    ).toBe('b')
    expect(newestDocument(['a', 'b'], {})).toBe('a')
    expect(fileTypeLabel('text/html; charset=utf-8', 'x')).toBe('HTML')
    expect(fileTypeLabel('application/octet-stream', 'report.Xlsx')).toBe('XLSX')
    expect(fileTypeLabel(undefined, 'notes')).toBe('FILE')
  })

  it("says how long ago in the viewer's language", () => {
    const now = Date.parse('2026-11-09T00:00:00Z')
    expect(relativeTime('2026-05-09T00:00:00Z', 'en-US', now)).toBe('6 months ago')
    expect(relativeTime('2026-11-08T00:00:00Z', 'zh-Hans', now)).toBe('昨天')
    expect(relativeTime(undefined, 'en-US', now)).toBe('')
  })
})
