import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { resolveNewRagSmokeConfig } from '../../../scripts/run-new-rag-smoke'
import { createApiContext, expectApiResponseOK } from '../../../support/api'

type KnowledgeFsScope = 'knowledge-spaces:read' | 'knowledge-spaces:write'
type DifyIdentity = { accountId: string; tenantId: string }
type KnowledgeSpaceDeletionSnapshot = { name: string; revision: number }

const base64Url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

export const createKnowledgeFsJwt = ({
  accountId,
  scope,
  secret,
  tenantId,
}: {
  accountId: string
  scope: KnowledgeFsScope
  secret: string
  tenantId: string
}) => {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(
    JSON.stringify({
      aud: 'knowledge-fs',
      caller_kind: 'interactive',
      dify_account_id: `dify-account:${accountId}`,
      exp: now + 60,
      iat: now,
      iss: 'dify',
      scopes: [scope],
      sub: `dify-workspace:${tenantId}`,
      tenant_id: tenantId,
    }),
  )
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const getDifyIdentity = async () => {
  const context = await createApiContext()
  try {
    const [accountResponse, workspaceResponse] = await Promise.all([
      context.get('/console/api/account/profile'),
      context.post('/console/api/workspaces/current', { data: {} }),
    ])
    await expectApiResponseOK(accountResponse, 'Read the current E2E account')
    await expectApiResponseOK(workspaceResponse, 'Read the current E2E workspace')
    const account = (await accountResponse.json()) as GetAccountProfileResponse
    const workspace = (await workspaceResponse.json()) as PostWorkspacesCurrentResponse
    if (!account.id || !workspace.id)
      throw new Error('The current Dify account or workspace has no stable identifier.')
    return { accountId: account.id, tenantId: workspace.id }
  } finally {
    await context.dispose()
  }
}

const directKnowledgeFsRequest = async ({
  accountId,
  body,
  method,
  path,
  requestHeaders,
  scope,
  tenantId,
}: {
  accountId: string
  body?: Record<string, unknown>
  method: 'DELETE' | 'GET' | 'POST'
  path: string
  requestHeaders?: Record<string, string>
  scope: KnowledgeFsScope
  tenantId: string
}) => {
  const config = resolveNewRagSmokeConfig(process.env)
  const token = createKnowledgeFsJwt({
    accountId,
    scope,
    secret: config.knowledgeFsJwtSecret,
    tenantId,
  })
  return fetch(new URL(path, `${config.knowledgeFsBaseUrl}/`), {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...requestHeaders,
    },
    method,
    signal: AbortSignal.timeout(30_000),
  })
}

export const assertKnowledgeFsAccessBoundaries = async (knowledgeSpaceId: string) => {
  const identity = await getDifyIdentity()
  const crossTenant = await directKnowledgeFsRequest({
    accountId: identity.accountId,
    method: 'GET',
    path: `knowledge-spaces/${knowledgeSpaceId}`,
    scope: 'knowledge-spaces:read',
    tenantId: `${identity.tenantId}-other`,
  })
  if (![403, 404].includes(crossTenant.status))
    throw new Error(
      `Cross-tenant KnowledgeFS read returned ${crossTenant.status}; expected 403 or 404.`,
    )

  const readOnlyWrite = await directKnowledgeFsRequest({
    accountId: identity.accountId,
    body: {
      idempotencyKey: `e2e-read-only-${knowledgeSpaceId}`,
      name: `E2E forbidden ${knowledgeSpaceId}`,
    },
    method: 'POST',
    path: 'knowledge-spaces',
    scope: 'knowledge-spaces:read',
    tenantId: identity.tenantId,
  })
  if (readOnlyWrite.status !== 403)
    throw new Error(`Read-only KnowledgeFS write returned ${readOnlyWrite.status}; expected 403.`)
}

export const deleteKnowledgeFsSpaceWithIdentity = async (
  knowledgeSpaceId: string,
  identity: DifyIdentity,
) => {
  const snapshotResponse = await directKnowledgeFsRequest({
    accountId: identity.accountId,
    method: 'GET',
    path: `knowledge-spaces/${knowledgeSpaceId}`,
    scope: 'knowledge-spaces:read',
    tenantId: identity.tenantId,
  })
  if (snapshotResponse.status === 404) return
  if (!snapshotResponse.ok)
    throw new Error(
      `Read KnowledgeFS smoke space ${knowledgeSpaceId} for cleanup failed with ${snapshotResponse.status} ${snapshotResponse.statusText}.`,
    )
  const snapshot = (await snapshotResponse.json()) as Partial<KnowledgeSpaceDeletionSnapshot>
  if (
    !snapshot.name ||
    typeof snapshot.revision !== 'number' ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 1
  )
    throw new Error(`KnowledgeFS smoke space ${knowledgeSpaceId} has no valid deletion snapshot.`)

  const response = await directKnowledgeFsRequest({
    accountId: identity.accountId,
    body: { challenge: snapshot.name, expectedRevision: snapshot.revision },
    method: 'DELETE',
    path: `knowledge-spaces/${knowledgeSpaceId}`,
    requestHeaders: { 'Idempotency-Key': `e2e-delete-${knowledgeSpaceId}` },
    scope: 'knowledge-spaces:write',
    tenantId: identity.tenantId,
  })
  if (response.ok || response.status === 404) return
  const body = await response.text().catch(() => '')
  throw new Error(
    `Delete KnowledgeFS smoke space ${knowledgeSpaceId} failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}.`,
  )
}

export const deleteKnowledgeFsSpace = async (knowledgeSpaceId: string) =>
  deleteKnowledgeFsSpaceWithIdentity(knowledgeSpaceId, await getDifyIdentity())
