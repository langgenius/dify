import type { GoldenQuestionDraft } from './types'

const goldenLinkPrefix = 'golden-question:'

export const qualityPageSize = 50

export const emptyGoldenQuestionDraft: GoldenQuestionDraft = {
  annotation: '',
  expectedEvidenceIds: [],
  matchPolicy: 'all',
  question: '',
  tags: [],
}

export function goldenQuestionPayload(draft: GoldenQuestionDraft) {
  return {
    annotation: draft.annotation,
    expected_evidence_ids: draft.expectedEvidenceIds,
    match_policy: draft.matchPolicy,
    question: draft.question,
    tags: draft.tags,
  }
}

export function visibleQualityTags(tags: string[]) {
  return tags.filter((tag) => !tag.startsWith(goldenLinkPrefix))
}

export function formatQualityUpdatedAt(value: string, locale: string) {
  const time = new Date(value)
  const elapsedHours = Math.max(0, (Date.now() - time.getTime()) / 3_600_000)
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (elapsedHours < 1) return relativeTime.format(0, 'minute')
  if (elapsedHours < 24) return relativeTime.format(-Math.floor(elapsedHours), 'hour')
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return relativeTime.format(-elapsedDays, 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(time)
}

export function formatQualityEvaluationCreatedAt(value: string, justNow: string, locale: string) {
  const elapsedMinutes = Math.max(0, (Date.now() - new Date(value).getTime()) / 60_000)
  if (elapsedMinutes < 1) return justNow
  if (elapsedMinutes < 60)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      -Math.floor(elapsedMinutes),
      'minute',
    )
  return formatQualityUpdatedAt(value, locale)
}

export function formatQualityReportCreatedAt(value: string, locale: string) {
  const time = new Date(value)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(time)
  const formattedTime = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(time)
  return `${date} · ${formattedTime}`
}
