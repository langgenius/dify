export function createDeploymentIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  return `deployment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
