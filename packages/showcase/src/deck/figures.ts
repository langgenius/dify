/**
 * Every number the deck shows, in one place.
 *
 * Headline figures come from Dify engineering for March – August 2026.
 * Release dates are the stable (non pre-release) GitHub releases of
 * langgenius/dify published in that window. Derived figures are computed
 * here so the slide and its table view can never disagree.
 */

export const PERIOD = {
  label: 'March – August 2026',
  /** 1 March 2026, 00:00 UTC. */
  start: Date.UTC(2026, 2, 1),
  /** 1 March – 31 August 2026, inclusive. */
  days: 184,
} as const

export const figures = {
  /** Product improvements shipped in the period. */
  improvements: 256,
  /** Commits landed on the main branch. */
  commits: 4011,
  /** Stable releases published. */
  releases: 10,
  /** Improvements co-created with the community. */
  coCreated: 106,
  coCreatedShare: 41.41,
  /** Community pull requests merged. */
  prsMerged: 1200,
  /** Lines of code contributed by the community. */
  communityLines: 329_961,
  /** Stable releases that shipped community-authored changes. */
  releasesWithCommunity: 9,
  /** Improvements to how Dify runs (performance, reliability, security, experience). */
  runtimeImprovements: 117,
  /** Of those, the ones on performance, reliability and security. */
  runtimeHardening: 69,
  runtimeHardeningShare: 58.97,
  /** Lines of test code added to the main product. */
  testLines: 1_337_022,
  /** Of those, the lines written by the community. */
  communityTestLines: 274_882,
  communityTestShare: 20.56,
} as const

export const derived = {
  improvementsByCore: figures.improvements - figures.coCreated,
  runtimeExperience: figures.runtimeImprovements - figures.runtimeHardening,
  coreTestLines: figures.testLines - figures.communityTestLines,
  daysPerRelease: Math.round(PERIOD.days / figures.releases),
  commitsPerRelease: Math.round(figures.commits / figures.releases),
  prsPerDay: Math.round((figures.prsMerged / PERIOD.days) * 10) / 10,
  linesPerPr: Math.round(figures.communityLines / figures.prsMerged),
} as const

export type Release = {
  tag: string
  /** ISO date (UTC) the release was published on GitHub. */
  date: string
}

export const releases: readonly Release[] = [
  { tag: '1.13.1', date: '2026-03-17' },
  { tag: '1.13.2', date: '2026-03-18' },
  { tag: '1.13.3', date: '2026-03-27' },
  { tag: '1.14.0', date: '2026-04-29' },
  { tag: '1.14.1', date: '2026-05-12' },
  { tag: '1.14.2', date: '2026-05-19' },
  { tag: '1.15.0', date: '2026-06-25' },
  { tag: '1.16.0', date: '2026-07-17' },
  { tag: '1.16.1', date: '2026-07-28' },
  { tag: '1.17.0', date: '2026-08-25' },
]

export const months = [
  { label: 'March', startDay: 0, length: 31 },
  { label: 'April', startDay: 31, length: 30 },
  { label: 'May', startDay: 61, length: 31 },
  { label: 'June', startDay: 92, length: 30 },
  { label: 'July', startDay: 122, length: 31 },
  { label: 'August', startDay: 153, length: 31 },
] as const

const DAY_MS = 86_400_000

/** Days since the start of the period, 0 = 1 March. */
export function dayIndex(isoDate: string) {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - PERIOD.start) / DAY_MS)
}

const integerFormat = new Intl.NumberFormat('en-US')

export function formatInt(value: number) {
  return integerFormat.format(value)
}

export function formatNumber(value: number, decimals = 0) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatPercent(value: number) {
  return `${formatNumber(value, 2)}%`
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDate(isoDate: string) {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`))
}

export const releaseRange = {
  first: releases[0]?.tag ?? '',
  last: releases[releases.length - 1]?.tag ?? '',
} as const
