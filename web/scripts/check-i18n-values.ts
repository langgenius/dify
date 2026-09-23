/**
 * Value-level checks for locale files.
 *
 * `check-i18n.js` compares key sets, so a translation can drop, invent or rename
 * an interpolation variable and still pass. Those breakages reach the user as a
 * raw `{{name}}` in the UI, or as a sentence missing the value it was meant to
 * show. The translation sync workflow asks its agent to preserve placeholders
 * exactly, and these functions are what verifies that it did.
 */

export type ValueIssueKind = 'placeholder' | 'tag'

export type ValueIssue = {
  key: string
  kind: ValueIssueKind
  expected: string[]
  actual: string[]
}

/** i18next interpolation, including formatters such as `{{count,number}}`. */
const PLACEHOLDER_PATTERN = /\{\{[^{}]*\}\}|\$\{[^{}]*\}/g

/** Markup handed to `<Trans>`, plus plain HTML tags used inside values. */
const TAG_PATTERN = /<\/?[a-z][^<>]*>/gi

function collect(value: string, pattern: RegExp): string[] {
  return (value.match(pattern) ?? []).sort()
}

/**
 * Interpolation variables in `value`, sorted so that reordering a sentence is
 * not reported as a difference.
 */
export function extractPlaceholders(value: string): string[] {
  return collect(value, PLACEHOLDER_PATTERN)
}

/** Markup tags in `value`, sorted for the same reason as placeholders. */
export function extractTags(value: string): string[] {
  return collect(value, TAG_PATTERN)
}

function sameMembers(expected: string[], actual: string[]): boolean {
  return (
    expected.length === actual.length && expected.every((item, index) => item === actual[index])
  )
}

/**
 * Compare one locale file against its en-US source.
 *
 * Only keys present in both files are compared; missing and extra keys are
 * already reported by the key-level check, and reporting them twice would bury
 * the value problems this is meant to surface.
 *
 * A key that is present but holds something other than a string is a different
 * case: the key check sees it and is satisfied, so nothing else would notice
 * that the sentence — and every placeholder in it — is gone. Such a value is
 * compared as the empty string, which makes a marker-bearing source fail here.
 */
export function findValueIssues(
  source: Record<string, unknown>,
  translation: Record<string, unknown>,
): ValueIssue[] {
  const issues: ValueIssue[] = []

  for (const [key, sourceValue] of Object.entries(source)) {
    if (typeof sourceValue !== 'string') continue
    if (!Object.hasOwn(translation, key)) continue

    const rawValue = translation[key]
    const translatedValue = typeof rawValue === 'string' ? rawValue : ''

    const expectedPlaceholders = extractPlaceholders(sourceValue)
    const actualPlaceholders = extractPlaceholders(translatedValue)
    if (!sameMembers(expectedPlaceholders, actualPlaceholders)) {
      issues.push({
        key,
        kind: 'placeholder',
        expected: expectedPlaceholders,
        actual: actualPlaceholders,
      })
    }

    const expectedTags = extractTags(sourceValue)
    const actualTags = extractTags(translatedValue)
    if (!sameMembers(expectedTags, actualTags))
      issues.push({ key, kind: 'tag', expected: expectedTags, actual: actualTags })
  }

  return issues
}

export function formatValueIssue(fileName: string, issue: ValueIssue): string {
  const label = issue.kind === 'placeholder' ? 'placeholders' : 'tags'
  const expected = issue.expected.length ? issue.expected.join(' ') : '(none)'
  const actual = issue.actual.length ? issue.actual.join(' ') : '(none)'
  return `${fileName}.${issue.key}: expected ${label} ${expected}, found ${actual}`
}
