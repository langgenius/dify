export function getDeploymentErrorMessage(error: unknown) {
  return error instanceof Error ? error.message || undefined : undefined
}
