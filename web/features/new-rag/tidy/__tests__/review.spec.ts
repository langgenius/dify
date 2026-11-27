import type { KnowledgeFsTidyFindingResponse as TidyFinding } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  disablePlan,
  evidenceOf,
  fileTypeLabel,
  groupDuplicates,
  groupPairs,
  isRewriteText,
  mergePlan,
  newestDocument,
  PLAN_REQUEST_SIZE,
  planRequests,
  relativeTime,
  REWRITE_MAX_LENGTH,
} from '../review'

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

  it('groups the conflicts and overlap of one document pair, whichever way round it is quoted', () => {
    const of = (id: string, kind: TidyFinding['kind'], left: string, right: string) => ({
      ...duplicate(id, left, right),
      kind,
    })
    const groups = groupPairs([
      of('c1', 'conflict', 'a', 'b'),
      of('s1', 'similar', 'b', 'a'),
      of('c2', 'conflict', 'b', 'a'),
      of('s2', 'similar', 'a', 'c'),
    ])
    expect(
      groups.map((group) => [
        group.documentIds,
        group.conflicts.map((finding) => finding.id),
        group.similar?.id ?? null,
      ]),
    ).toEqual([
      [['a', 'b'], ['c1', 'c2'], 's1'],
      [['a', 'c'], [], 's2'],
    ])
    const [pair] = groups
    expect(evidenceOf(pair!.conflicts[1]!, 'a').documentId).toBe('a')

    // The overlap finding carries the disable; the conflicts have nothing left to decide.
    expect(
      disablePlan(pair!, 'b').map((step) => [step.finding.id, step.action, step.documentId]),
    ).toEqual([
      ['s1', 'disable_document', 'b'],
      ['c1', 'review', undefined],
      ['c2', 'review', undefined],
    ])
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

describe('isRewriteText', () => {
  it('accepts what the API accepts: some text, up to its length limit', () => {
    expect(REWRITE_MAX_LENGTH).toBe(20_000)
    expect(isRewriteText('x'.repeat(REWRITE_MAX_LENGTH))).toBe(true)
    expect(isRewriteText('x'.repeat(REWRITE_MAX_LENGTH + 1))).toBe(false)
    expect(isRewriteText(' \n\t')).toBe(false)
  })
})

describe('planRequests', () => {
  const review = (id: string) => ({ finding: duplicate(id, 'a', 'b'), action: 'review' as const })
  const ids = (plan: Parameters<typeof planRequests>[0]) =>
    planRequests(plan).map((request) => request.map((step) => step.finding.id))

  it('sends a merge as one request so it applies to every finding or none', () => {
    expect(ids([review('1'), review('2'), review('3')])).toEqual([['1', '2', '3']])
    expect(ids([])).toEqual([])
  })

  it('starts another request once one is full', () => {
    const plan = Array.from({ length: PLAN_REQUEST_SIZE + 1 }, (_, index) => review(`${index}`))
    expect(planRequests(plan).map((request) => request.length)).toEqual([PLAN_REQUEST_SIZE, 1])
  })

  it('never lets an undo share a request', () => {
    const undo = (id: string) => ({ finding: duplicate(id, 'a', 'b'), action: 'undo' as const })
    expect(ids([review('1'), undo('2'), undo('3'), review('4'), review('5')])).toEqual([
      ['1'],
      ['2'],
      ['3'],
      ['4', '5'],
    ])
  })
})
