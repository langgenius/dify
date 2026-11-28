/**
 * Pure helpers behind the Tidy review cards: grouping identical documents and document pairs,
 * planning the actions a choice implies, and the labels shown on document tiles.
 */
import type {
  KnowledgeFsTidyActionPayload,
  KnowledgeFsTidyDocumentCardResponse,
  KnowledgeFsTidyFindingResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'

type TidyFinding = KnowledgeFsTidyFindingResponse
type TidyDocumentCard = KnowledgeFsTidyDocumentCardResponse
/** Actions that need no text; `adopt` carries a replacement and is requested on its own. */
type TidyAction = Exclude<KnowledgeFsTidyActionPayload['action'], 'adopt'>

/**
 * Identical documents linked by duplicate findings: one connected component of the findings
 * given to `groupDuplicates`. It is the whole set of copies only if those were every open
 * duplicate finding; built from part of them it can lack copies, or be one of several groups
 * that are really one.
 */
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

/** One request settles the finding it addresses plus 63 others (the API's limit). */
export const PLAN_REQUEST_SIZE = 64

type JoinableAction = PlannedAction & { action: Exclude<TidyAction, 'undo'> }

const isJoinable = (step: PlannedAction): step is JoinableAction => step.action !== 'undo'

/**
 * Splits a plan into requests the API applies all or nothing: the first step addresses the
 * request, the rest ride along. An undo is only ever sent on its own.
 */
export function planRequests(plan: readonly PlannedAction[]) {
  const requests: [PlannedAction, ...JoinableAction[]][] = []
  for (const step of plan) {
    const open = requests.at(-1)
    if (open && isJoinable(step) && isJoinable(open[0]) && open.length < PLAN_REQUEST_SIZE)
      open.push(step)
    else requests.push([step])
  }
  return requests
}

/**
 * Keep `keepId`, disable every other document of the group. Each finding can disable one of its
 * two documents, so walk the findings outward from the kept document: every other document is
 * disabled through the finding that first reached it, and the remaining findings are marked
 * reviewed. Every finding in `group` ends up handled, and nothing outside it: a copy the group
 * does not hold stays enabled. Offer this only for a group built from every open duplicate
 * finding.
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

/**
 * The open conflicts and overlap between one pair of documents. A reviewer first decides how the
 * two documents relate, so several findings about the same pair read as one card. It holds the
 * pair's findings among those given to `groupPairs`, which are all of them only if every open
 * finding of those kinds was given.
 */
export type PairGroup = {
  key: string
  /** In the order of the first finding; later findings may list the pair the other way round. */
  documentIds: [string, string]
  findings: TidyFinding[]
  conflicts: TidyFinding[]
  similar: TidyFinding | null
}

export function groupPairs(findings: readonly TidyFinding[]): PairGroup[] {
  const groups = new Map<string, PairGroup>()
  for (const finding of findings) {
    const ids: [string, string] = [finding.left.documentId, finding.right.documentId]
    const pair = [...ids].sort().join('\u0000')
    let group = groups.get(pair)
    if (!group) {
      group = { key: finding.id, documentIds: ids, findings: [], conflicts: [], similar: null }
      groups.set(pair, group)
    }
    group.findings.push(finding)
    if (finding.kind === 'conflict') group.conflicts.push(finding)
    else group.similar ??= finding
  }
  return [...groups.values()]
}

/** The evidence a finding quotes from `documentId`. */
export function evidenceOf(finding: TidyFinding, documentId: string) {
  return finding.left.documentId === documentId ? finding.left : finding.right
}

/**
 * Disable one document of the pair. With it out of retrieval, the other findings in `group` have
 * nothing left to decide, so they are marked reviewed in the same run. A finding about the pair
 * that the group does not hold stays open, so offer this only for a group built from every open
 * finding of its kinds.
 */
export function disablePlan(group: PairGroup, documentId: string): PlannedAction[] {
  const anchor = group.similar ?? group.findings[0]
  if (!anchor) return []
  return [
    { finding: anchor, action: 'disable_document', documentId },
    ...group.findings
      .filter((finding) => finding !== anchor)
      .map((finding): PlannedAction => ({ finding, action: 'review' })),
  ]
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

/** Adopt one side of a conflict: replace `passage` in the other document with `replacement`. */
export type RewriteRequest = {
  finding: TidyFinding
  /** The document whose statement is kept. */
  keptDocumentId: string
  keptTitle: string
  /** The document whose passage is rewritten. */
  targetTitle: string
  passage: string
  replacement: string
}

/** The longest replacement the API accepts (`replacement` of the action payload). */
export const REWRITE_MAX_LENGTH = 20_000

/** Whether `text` may be sent as a replacement: the API refuses blank and over-long text. */
export function isRewriteText(text: string) {
  return text.trim().length > 0 && text.length <= REWRITE_MAX_LENGTH
}

/** Why the server would not edit a passage in place (`details.parameters.status` of a conflict). */
const REWRITE_REFUSALS = [
  'document_busy',
  'not_indexed',
  'passage_not_found',
  'passage_ambiguous',
  'no_change',
  'too_long',
  'unsupported',
] as const
export type RewriteRefusal = (typeof REWRITE_REFUSALS)[number]

/** The server's reason for refusing a rewrite, when it gave one the page can explain. */
export function rewriteRefusal(data: unknown): RewriteRefusal | undefined {
  if (typeof data !== 'object' || data === null || !('details' in data)) return
  const details = data.details
  if (typeof details !== 'object' || details === null || !('parameters' in details)) return
  const parameters = details.parameters
  if (typeof parameters !== 'object' || parameters === null || !('status' in parameters)) return
  return REWRITE_REFUSALS.find((known) => known === parameters.status)
}
