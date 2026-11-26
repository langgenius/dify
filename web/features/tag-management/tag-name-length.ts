import { ORPCError } from '@orpc/client'

export const MAX_TAG_NAME_LENGTH = 50

export function isTagNameTooLong(name: string) {
  return Array.from(name.trim()).length > MAX_TAG_NAME_LENGTH
}

export function isTagNameTooLongError(error: unknown) {
  if (!(error instanceof ORPCError) || error.status !== 422) return false
  // The Console sends Pydantic validation issues as JSON in the error message.
  try {
    const issues: unknown = JSON.parse(error.message)
    return (
      Array.isArray(issues) &&
      issues.some(
        (issue) =>
          issue?.type === 'string_too_long' &&
          Array.isArray(issue.loc) &&
          issue.loc.length === 1 &&
          issue.loc[0] === 'name',
      )
    )
  } catch {
    return false
  }
}
