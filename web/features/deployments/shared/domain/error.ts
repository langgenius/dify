type DeploymentErrorPayload = {
  message?: unknown
  error?: unknown
  reason?: unknown
  code?: unknown
  metadata?: unknown
  unsupported_nodes?: unknown
}

const APP_DEPLOY_UNSUPPORTED_DSL_NODE_TYPE = 'APPDEPLOY_UNSUPPORTED_DSL_NODE_TYPE'

export type UnsupportedDslNode = {
  id?: string
  type?: string
}

export type UnsupportedDslNodeError = {
  message?: string
  nodes: UnsupportedDslNode[]
}

function nonEmptyString(value: unknown) {
  if (typeof value !== 'string') return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatDeploymentError(data: DeploymentErrorPayload) {
  const message = nonEmptyString(data.message) ?? nonEmptyString(data.error)
  const reason = nonEmptyString(data.reason) ?? nonEmptyString(data.code)

  if (message && reason) return `${message} (${reason})`

  return message ?? reason
}

async function deploymentErrorData(error: unknown) {
  if (error instanceof Response && !error.bodyUsed) {
    try {
      return (await error.clone().json()) as DeploymentErrorPayload
    } catch {}
  }

  return undefined
}

function deploymentErrorReason(data: DeploymentErrorPayload) {
  return nonEmptyString(data.reason) ?? nonEmptyString(data.code)
}

function unsupportedNodesPayload(data: DeploymentErrorPayload) {
  if (isRecord(data.metadata)) return data.metadata.unsupported_nodes

  return data.unsupported_nodes
}

function parsedJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function unsupportedDslNode(value: unknown) {
  if (!isRecord(value)) return undefined

  const id = nonEmptyString(value.id)
  const type = nonEmptyString(value.type)
  if (!id && !type) return undefined

  return {
    ...(id ? { id } : {}),
    ...(type ? { type } : {}),
  } satisfies UnsupportedDslNode
}

function unsupportedDslNodes(value: unknown) {
  const nodeList = typeof value === 'string' ? parsedJsonValue(value) : value
  if (!Array.isArray(nodeList)) return []

  const seen = new Set<string>()
  const nodes: UnsupportedDslNode[] = []

  nodeList.forEach((item) => {
    const node = unsupportedDslNode(item)
    if (!node) return

    const key = `${node.id}\u0000${node.type}`
    if (seen.has(key)) return

    seen.add(key)
    nodes.push(node)
  })

  return nodes
}

export async function unsupportedDslNodeError(
  error: unknown,
): Promise<UnsupportedDslNodeError | undefined> {
  const errorData = await deploymentErrorData(error)
  if (!errorData) return undefined

  if (deploymentErrorReason(errorData) !== APP_DEPLOY_UNSUPPORTED_DSL_NODE_TYPE) return undefined

  return {
    message: formatDeploymentError(errorData),
    nodes: unsupportedDslNodes(unsupportedNodesPayload(errorData)),
  }
}

export async function deploymentErrorMessage(error: unknown) {
  const errorData = await deploymentErrorData(error)
  if (errorData) return formatDeploymentError(errorData)

  if (error instanceof Error) return nonEmptyString(error.message)

  return undefined
}
