// Talks to the external chatkit-backend service (NOT Dify's own API) that
// resolves a website hostname to its Diffy iframe embed URL. That service
// owns the data; this page is only a UI for managing it from inside Dify.

export type DiffyAgent = {
  id: string
  name: string
  hostname: string
  iframe_url: string
}

export type DiffyAgentInput = {
  name: string
  hostname: string
  iframe_url: string
}

function backendUrl() {
  const url = process.env.NEXT_PUBLIC_DIFFY_BACKEND_URL
  if (!url) throw new Error('NEXT_PUBLIC_DIFFY_BACKEND_URL is not configured')
  return url.replace(/\/+$/, '')
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = await res.json()
    return typeof data?.error === 'string' ? data.error : fallback
  }
  catch {
    return fallback
  }
}

export async function fetchDiffyAgents(token: string): Promise<DiffyAgent[]> {
  const res = await fetch(`${backendUrl()}/admin/diffy-agents`, {
    headers: authHeaders(token),
  })

  if (!res.ok)
    throw new Error(await readErrorMessage(res, 'Failed to load agents'))

  const data = await res.json()
  return data.agents ?? []
}

export async function createDiffyAgent(token: string, input: DiffyAgentInput): Promise<DiffyAgent> {
  const res = await fetch(`${backendUrl()}/admin/diffy-agents`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!res.ok)
    throw new Error(await readErrorMessage(res, 'Failed to add agent'))

  const data = await res.json()
  return data.agent
}

export async function deleteDiffyAgent(token: string, id: string): Promise<void> {
  const res = await fetch(`${backendUrl()}/admin/diffy-agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })

  if (!res.ok)
    throw new Error(await readErrorMessage(res, 'Failed to delete agent'))
}
