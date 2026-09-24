export function isSkillErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function normalizeSkillError(error: unknown): Promise<unknown> {
  if (!(error instanceof Response)) return error

  try {
    return await error.clone().json()
  } catch {
    return error
  }
}

export function getSkillErrorCode(error: unknown): string | undefined {
  if (!isSkillErrorRecord(error)) return undefined

  const data = isSkillErrorRecord(error.data) ? error.data : undefined
  const candidates = [error, data, error.body, data?.body]
  for (const candidate of candidates) {
    if (isSkillErrorRecord(candidate) && typeof candidate.code === 'string') return candidate.code
  }

  const messages = candidates.flatMap((candidate) => {
    if (!isSkillErrorRecord(candidate)) return []
    return typeof candidate.message === 'string' ? [candidate.message] : []
  })
  if (messages.some((message) => /must contain SKILL\.md/i.test(message))) return 'missing_skill_md'
  if (messages.some((message) => /skill name .+ already exists/i.test(message)))
    return 'skill_name_conflict'
  if (messages.some((message) => /skill limit/i.test(message))) return 'skill_limit_exceeded'

  return undefined
}

function getSkillErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!isSkillErrorRecord(error)) return undefined

  const data = isSkillErrorRecord(error.data) ? error.data : undefined
  const candidates = [error, data, error.body, data?.body]
  for (const candidate of candidates) {
    if (isSkillErrorRecord(candidate) && isSkillErrorRecord(candidate.details))
      return candidate.details
  }

  return undefined
}

export function getSkillErrorDetailNumber(error: unknown, key: string): number | undefined {
  const value = getSkillErrorDetails(error)?.[key]
  return typeof value === 'number' ? value : undefined
}

export function getSkillErrorDetailString(error: unknown, key: string): string | undefined {
  const value = getSkillErrorDetails(error)?.[key]
  if (typeof value === 'string') return value
  if (key !== 'name' || !isSkillErrorRecord(error)) return undefined

  const data = isSkillErrorRecord(error.data) ? error.data : undefined
  const candidates = [error, data, error.body, data?.body]
  for (const candidate of candidates) {
    if (!isSkillErrorRecord(candidate) || typeof candidate.message !== 'string') continue
    const match = candidate.message.match(/skill name ["']?(.+?)["']? already exists/i)
    if (match?.[1]) return match[1]
  }

  return undefined
}
