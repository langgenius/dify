import type { ActiveContext } from './hosts'
import type { HttpClient } from '@/http/types'
import { AccountClient } from '@/api/account'
import { WorkspacesClient } from '@/api/workspaces'
import { getEnv } from '@/env/registry'
import { createHttpClient } from '@/http/client'
import { DEFAULT_HOST, openAPIBase, resolveHost } from '@/util/host'

/** Resolve a process-scoped credential without reading or saving a login session. */
export async function environmentTokenContext(
  token: string,
  retryAttempts: number,
): Promise<{ active: ActiveContext; http: HttpClient }> {
  const rawHost = getEnv('DIFY_HOST')?.trim() || DEFAULT_HOST
  // Local development over loopback needs no TLS bypass for remote hosts.
  const loopback = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(rawHost)
  const host = resolveHost({ raw: rawHost, insecure: loopback })
  const http = createHttpClient({ baseURL: openAPIBase(host), bearer: token, retryAttempts })
  if (token.startsWith('sk-')) {
    const { workspaces } = await new WorkspacesClient(http).list()
    return {
      http,
      active: {
        host,
        email: '',
        ctx: { account: { email: '', name: '' }, workspace: workspaces[0] },
      },
    }
  }
  const identity = await new AccountClient(http).get()
  const account = identity.account ?? { email: '', name: '' }
  return {
    http,
    active: {
      host,
      email: account.email,
      ctx: {
        account,
        workspace: identity.workspaces?.find((w) => w.id === identity.default_workspace_id),
        external_subject:
          identity.subject_type === 'external_sso'
            ? { email: identity.subject_email ?? '', issuer: identity.subject_issuer ?? '' }
            : undefined,
      },
    },
  }
}
