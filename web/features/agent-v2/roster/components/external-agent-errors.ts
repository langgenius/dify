type ErrorPayload = {
  description?: unknown
  error?: unknown
  message?: unknown
}

const getNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

export const getExternalAgentErrorMessage = async (error: unknown) => {
  if (error instanceof Response && !error.bodyUsed) {
    try {
      const payload = (await error.clone().json()) as ErrorPayload
      return (
        getNonEmptyString(payload.message) ??
        getNonEmptyString(payload.description) ??
        getNonEmptyString(payload.error)
      )
    } catch {}
  }

  if (error instanceof Error) return getNonEmptyString(error.message)

  return undefined
}
