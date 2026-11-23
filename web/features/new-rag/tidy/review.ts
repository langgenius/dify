/**
 * Pure helpers behind the Tidy review cards: grouping identical documents, planning a "keep one"
 * merge, and the labels shown on document tiles.
 */
import type {
  KnowledgeFsTidyDocumentCardResponse,
  KnowledgeFsTidyFindingResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

type TidyFinding = KnowledgeFsTidyFindingResponse
type TidyDocumentCard = KnowledgeFsTidyDocumentCardResponse
type TidyFindingKind = TidyFinding['kind']
export type TidyAction = 'dismiss' | 'review' | 'disable_document' | 'undo'

/** Conflicts first (they need a decision), then exact copies, then overlapping documents. */
export const TIDY_KIND_ORDER: readonly TidyFindingKind[] = ['conflict', 'duplicate', 'similar']

/** Identical documents linked by open duplicate findings (connected components). */
export type DuplicateGroup = {
  key: string
  documentIds: string[]
  findings: TidyFinding[]
  title: string
}

export function groupDuplicates(findings: readonly TidyFinding[]): DuplicateGroup[] {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const up = parent.get(id) ?? id
    if (up === id) return id
    const root = find(up)
    parent.set(id, root)
    return root
  }
  for (const finding of findings) {
    const a = find(finding.left.documentId)
    const b = find(finding.right.documentId)
    parent.set(finding.left.documentId, a)
    parent.set(finding.right.documentId, b)
    if (a !== b) parent.set(b, a)
  }
  const groups = new Map<string, DuplicateGroup>()
  for (const finding of findings) {
    const root = find(finding.left.documentId)
    let group = groups.get(root)
    if (!group) {
      group = { key: finding.id, documentIds: [], findings: [], title: finding.left.title }
      groups.set(root, group)
    }
    group.findings.push(finding)
    for (const id of [finding.left.documentId, finding.right.documentId])
      if (!group.documentIds.includes(id)) group.documentIds.push(id)
  }
  return [...groups.values()].sort((a, b) => b.documentIds.length - a.documentIds.length)
}

export type PlannedAction = {
  finding: TidyFinding
  action: TidyAction
  documentId?: string
}

/**
 * Keep `keepId`, disable every other document of the group. Each finding can disable one of its
 * two documents, so walk the findings outward from the kept document: every other document is
 * disabled through the finding that first reached it, and the remaining findings are marked
 * reviewed. Every finding of the group ends up handled.
 */
export function mergePlan(group: DuplicateGroup, keepId: string): PlannedAction[] {
  const plan: PlannedAction[] = []
  const used = new Set<string>()
  const reached = new Set([keepId])
  const queue = [keepId]
  while (queue.length) {
    const current = queue.shift() as string
    for (const finding of group.findings) {
      if (used.has(finding.id)) continue
      const other =
        finding.left.documentId === current
          ? finding.right.documentId
          : finding.right.documentId === current
            ? finding.left.documentId
            : null
      if (!other || reached.has(other)) continue
      used.add(finding.id)
      reached.add(other)
      queue.push(other)
      plan.push({ finding, action: 'disable_document', documentId: other })
    }
  }
  for (const finding of group.findings)
    if (!used.has(finding.id)) plan.push({ finding, action: 'review' })
  return plan
}

/** The most recently published of `ids` (by card), or the first one when cards are missing. */
export function newestDocument(
  ids: readonly string[],
  cards: Readonly<Record<string, TidyDocumentCard>>,
) {
  let best = ids[0] ?? ''
  for (const id of ids) {
    const at = Date.parse(cards[id]?.publishedAt ?? '')
    const bestAt = Date.parse(cards[best]?.publishedAt ?? '')
    if (Number.isFinite(at) && (!Number.isFinite(bestAt) || at > bestAt)) best = id
  }
  return best
}

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/html': 'HTML',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
}

/** Short file type for a tile: from the MIME type, else the title's extension. */
export function fileTypeLabel(mimeType: string | undefined, title: string) {
  const known = mimeType
    ? MIME_LABELS[mimeType.split(';')[0]?.trim().toLowerCase() ?? '']
    : undefined
  if (known) return known
  const extension = /\.([a-z0-9]{1,6})$/iu.exec(title)?.[1]
  if (extension) return extension.toUpperCase()
  if (mimeType?.startsWith('image/')) return 'IMG'
  return 'FILE'
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** "6 months ago" / "6个月前"; "just now" below a minute. */
export function relativeTime(value: string | undefined, locale: string, now = Date.now()) {
  const at = Date.parse(value ?? '')
  if (!Number.isFinite(at)) return ''
  const elapsed = now - at
  let format: Intl.RelativeTimeFormat
  try {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  } catch {
    format = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  }
  for (const [unit, size] of UNITS)
    if (Math.abs(elapsed) >= size) return format.format(-Math.round(elapsed / size), unit)
  return format.format(0, 'minute')
}
