import type { DifyWorld } from '../../../support/world'
import { skipBlockedPrecondition } from './common'

const isTruthyEnv = (value: string | undefined) => value === '1' || value === 'true'

const getDefaultAgentBackendURL = () => {
  const port = process.env.E2E_AGENT_BACKEND_PORT?.trim() || '5050'

  return `http://127.0.0.1:${port}`
}

const getShellctlURL = () => {
  const explicitE2EURL = process.env.E2E_SHELLCTL_URL?.trim()
  if (explicitE2EURL) return explicitE2EURL.replace(/\/$/, '')

  const explicitAgentURL = process.env.DIFY_AGENT_SHELLCTL_ENTRYPOINT?.trim()
  if (explicitAgentURL) return explicitAgentURL.replace(/\/$/, '')

  if (isTruthyEnv(process.env.E2E_START_AGENT_BACKEND)) {
    const port = process.env.E2E_SHELLCTL_PORT?.trim() || '5004'
    return `http://127.0.0.1:${port}`
  }

  return undefined
}

const getAgentBackendURL = () => {
  const explicitE2EURL = process.env.E2E_AGENT_BACKEND_URL?.trim()
  if (explicitE2EURL) return explicitE2EURL.replace(/\/$/, '')

  const explicitAPIURL = process.env.AGENT_BACKEND_BASE_URL?.trim()
  if (explicitAPIURL) return explicitAPIURL.replace(/\/$/, '')

  if (isTruthyEnv(process.env.E2E_START_AGENT_BACKEND)) return getDefaultAgentBackendURL()

  return undefined
}

const checkRuntimeEndpoint = async ({
  path,
  remediation,
  title,
  url,
  world,
}: {
  path: string
  remediation: string
  title: string
  url: string
  world: DifyWorld
}) => {
  const healthURL = `${url}${path}`
  try {
    const response = await fetch(healthURL)
    if (response.ok) return undefined

    return skipBlockedPrecondition(
      world,
      `${title} did not respond successfully at ${healthURL}: ${response.status} ${response.statusText}.`,
      {
        owner: 'e2e/runtime',
        remediation,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return skipBlockedPrecondition(world, `${title} is unreachable at ${healthURL}: ${message}.`, {
      owner: 'e2e/runtime',
      remediation,
    })
  }
}

export async function skipMissingAgentBackendRuntime(world: DifyWorld) {
  const agentBackendURL = getAgentBackendURL()

  if (!agentBackendURL) {
    return skipBlockedPrecondition(
      world,
      'Agent v2 runtime backend is not configured. This scenario needs the standalone dify-agent run server, not just an active model provider.',
      {
        owner: 'e2e/runtime',
        remediation:
          'Run with E2E_START_AGENT_BACKEND=1 to let E2E start dify-agent, or set E2E_AGENT_BACKEND_URL/AGENT_BACKEND_BASE_URL to an existing dify-agent server.',
      },
    )
  }

  const agentBackendBlock = await checkRuntimeEndpoint({
    path: '/openapi.json',
    remediation:
      'Start a healthy dify-agent server and make sure AGENT_BACKEND_BASE_URL points to it before running Agent v2 runtime scenarios.',
    title: 'Agent v2 runtime backend',
    url: agentBackendURL,
    world,
  })
  if (agentBackendBlock) return agentBackendBlock

  const shellctlURL = getShellctlURL()
  if (shellctlURL) {
    const shellctlBlock = await checkRuntimeEndpoint({
      path: '/healthz',
      remediation:
        'Start the shellctl local sandbox, or run with E2E_START_AGENT_BACKEND=1 so E2E starts it together with dify-agent.',
      title: 'Agent v2 shellctl sandbox',
      url: shellctlURL,
      world,
    })
    if (shellctlBlock) return shellctlBlock
  }

  return agentBackendURL
}
