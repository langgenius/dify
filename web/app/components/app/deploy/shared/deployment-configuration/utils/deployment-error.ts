function messageFrom(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined

  if ('message' in value && typeof value.message === 'string')
    return value.message.trim() || undefined
  if ('error' in value && typeof value.error === 'string') return value.error.trim() || undefined

  return undefined
}

export function getDeploymentErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'body' in data) {
      const bodyMessage = messageFrom(data.body)
      if (bodyMessage) return bodyMessage
    }

    const dataMessage = messageFrom(data)
    if (dataMessage) return dataMessage
  }

  return messageFrom(error)
}

export async function normalizeDeploymentError(error: unknown) {
  if (error instanceof Response && !error.bodyUsed) {
    try {
      const response: unknown = await error.clone().json()
      const message = getDeploymentErrorMessage(response)
      if (message) return new Error(message)
    } catch {}
  }

  return error
}
