// Talks to the diffy-backend service (NOT Dify's own API) that resolves a
// website hostname to its Diffy iframe embed URL. That service owns the data;
// this page is only a UI for managing it from inside Dify.
//
// Sign-in: the browser's Dify console session (cookie + CSRF header) is sent
// along, and the backend asks Dify whether the caller is the workspace owner.
// An optional admin password (Bearer) is the fallback when that is not set up.

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

const DEFAULT_BACKEND_URL = '/diffy-backend'

export class DiffyApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DiffyApiError'
    this.status = status
  }
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof DiffyApiError && error.status === 401
}

// Address of the backend as the browser reaches it, e.g. "/diffy-backend"
// (behind Dify's nginx) or "https://host/diffy-backend".
export function backendUrl() {
  const url = process.env.NEXT_PUBLIC_DIFFY_BACKEND_URL || DEFAULT_BACKEND_URL
  return url.replace(/\/+$/, '')
}

// Full address of the backend, for snippets that are pasted into other sites.
export function absoluteBackendUrl() {
  return new URL(backendUrl(), window.location.href).toString().replace(/\/+$/, '')
}

// Dify keeps its CSRF token in a JavaScript-readable cookie and its own
// frontend echoes it in a header; the backend forwards both to Dify to verify
// the session. The cookie gets a "__Host-" prefix on HTTPS sites.
function readCsrfToken() {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?csrf_token=([^;]*)/)
  return match?.[1] ?? ''
}

function requestHeaders(token: string, hasBody: boolean) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const csrf = readCsrfToken()
  if (csrf) headers['X-CSRF-Token'] = csrf
  if (hasBody) headers['Content-Type'] = 'application/json'
  return headers
}

async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = await res.json()
    return typeof data?.error === 'string' ? data.error : fallback
  } catch {
    return fallback
  }
}

async function apiFetch(
  path: string,
  token: string,
  init: { method?: string; body?: string },
  fallbackMessage: string,
) {
  const res = await fetch(`${backendUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: requestHeaders(token, init.body !== undefined),
  })

  if (!res.ok) throw new DiffyApiError(await readErrorMessage(res, fallbackMessage), res.status)

  return res
}

// `token` is the optional admin password; pass '' to rely on the Dify session.
export async function fetchDiffyAgents(token: string): Promise<DiffyAgent[]> {
  const res = await apiFetch('/admin/diffy-agents', token, {}, 'Failed to load agents')
  const data = await res.json()
  return data.agents ?? []
}

export async function createDiffyAgent(
  token: string,
  input: DiffyAgentInput,
): Promise<DiffyAgent> {
  const res = await apiFetch(
    '/admin/diffy-agents',
    token,
    { method: 'POST', body: JSON.stringify(input) },
    'Failed to add agent',
  )
  const data = await res.json()
  return data.agent
}

export async function updateDiffyAgent(
  token: string,
  id: string,
  input: DiffyAgentInput,
): Promise<DiffyAgent> {
  const res = await apiFetch(
    `/admin/diffy-agents/${encodeURIComponent(id)}`,
    token,
    { method: 'PUT', body: JSON.stringify(input) },
    'Failed to update agent',
  )
  const data = await res.json()
  return data.agent
}

export async function deleteDiffyAgent(token: string, id: string): Promise<void> {
  await apiFetch(
    `/admin/diffy-agents/${encodeURIComponent(id)}`,
    token,
    { method: 'DELETE' },
    'Failed to delete agent',
  )
}
