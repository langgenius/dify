type DeploymentErrorResponse = {
  message?: unknown
  error?: unknown
  reason?: unknown
  code?: unknown
}

function nonEmptyString(value: unknown) {
  if (typeof value !== 'string')
    return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

function formatDeploymentError(data: DeploymentErrorResponse) {
  const message = nonEmptyString(data.message) ?? nonEmptyString(data.error)
  const reason = nonEmptyString(data.reason) ?? nonEmptyString(data.code)

  if (message && reason)
    return `${message} (${reason})`

  return message ?? reason
}

export async function deploymentErrorMessage(error: unknown) {
  if (error instanceof Response && !error.bodyUsed) {
    try {
      const errorData = await error.clone().json() as DeploymentErrorResponse
      return formatDeploymentError(errorData)
    }
    catch {}
  }

  if (error instanceof Error)
    return nonEmptyString(error.message)

  return undefined
}
