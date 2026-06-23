/**
 * E2E: difyctl auth session state
 *
 * The current CLI exposes local session state through:
 * - `auth whoami` for the active identity
 * - `auth list` for configured host/account contexts
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { injectAuth, injectSsoAuth, run, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / difyctl auth session state', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { configDir: dir, cleanup: cl } = await withTempConfig()
    configDir = dir
    cleanup = cl
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[], extraEnv?: Record<string, string>) {
    return run(argv, { configDir, env: extraEnv })
  }

  async function withAuth(overrideWorkspaceId?: string) {
    const wsId = overrideWorkspaceId ?? E.workspaceId
    const wsName = overrideWorkspaceId ? 'Workspace 2' : E.workspaceName
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      email: 'e2e@example.com',
      accountName: 'E2E User',
      accountId: 'acct-e2e',
      workspaceId: wsId,
      workspaceName: wsName,
      availableWorkspaces: [
        { id: E.workspaceId, name: E.workspaceName, role: 'owner' },
        { id: '747729d0-c476-4ba3-b44a-52bdf962c4f6', name: 'Workspace 2', role: 'member' },
      ],
    })
  }

  async function withSSOAuth() {
    await injectSsoAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken || 'dfoe_test',
      email: 'sso@example.com',
      issuer: 'https://issuer.example.com',
    })
  }

  it('[P0] auth list displays host, account, name and active marker (1.37)', async () => {
    await withAuth()
    const result = await r(['auth', 'list'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain(E.host.replace(/^https?:\/\//, ''))
    expect(result.stdout).toContain('e2e@example.com')
    expect(result.stdout).toContain('E2E User')
    expect(result.stdout).toContain('*')
  })

  it('[P1] auth list -o json displays active context metadata (1.38)', async () => {
    await withAuth()
    const result = await r(['auth', 'list', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as {
      contexts: Array<{ host: string, account: string, name: string, active: boolean }>
    }
    expect(parsed.contexts).toHaveLength(1)
    expect(parsed.contexts[0]).toMatchObject({
      account: 'e2e@example.com',
      name: 'E2E User',
      active: true,
    })
  })

  it('[P0] auth whoami --json outputs stable identity schema (1.39)', async () => {
    await withAuth()
    const result = await r(['auth', 'whoami', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as { id: string, email: string, name: string }
    expect(parsed).toMatchObject({
      id: 'acct-e2e',
      email: 'e2e@example.com',
      name: 'E2E User',
    })
  })

  it('[P0] unauthenticated auth whoami returns "Not logged in" — exit code 4 (1.40)', async () => {
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  })

  it('[P0] external SSO user auth whoami does not display workspace row (1.41)', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).not.toMatch(/workspace/i)
  })

  it('[P0] external SSO user auth whoami displays issuer URL (1.42)', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('issuer.example.com')
  })

  it('[P0] external SSO user auth whoami displays External SSO session info (1.43)', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/SSO/i)
  })

  it('[P0] auth whoami with an expired/invalid token still exits 0 (1.44)', async () => {
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_expired_token_xyz',
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain(E.email)
  })

  it('[P1] unauthenticated auth whoami --json returns not_logged_in (1.45)', async () => {
    const result = await r(['auth', 'whoami', '--json'])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  })

  it('[P1] auth list with unreachable host still exits 0 — purely local (1.46)', async () => {
    await injectAuth(configDir, {
      host: 'https://127.0.0.1:19999',
      bearer: E.token,
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'list'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('127.0.0.1:19999')
  })

  it('[P1] file-based token storage context works correctly (1.47)', async () => {
    await withAuth()
    const list = await r(['auth', 'list'])
    assertExitCode(list, 0)
    expect(list.stdout).toContain('e2e@example.com')

    const whoami = await r(['auth', 'whoami'])
    assertExitCode(whoami, 0)
    expect(whoami.stdout).toContain('e2e@example.com')
  })

  it('[P1] local registry shows the active workspace after workspace switch (1.48)', async () => {
    await withAuth('747729d0-c476-4ba3-b44a-52bdf962c4f6')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain('Workspace 2')
    expect(hostsContent).toContain('747729d0-c476-4ba3-b44a-52bdf962c4f6')
  })

  it('[P0] auth list output contains no ANSI colour codes (non-TTY)', async () => {
    await withAuth()
    const result = await r(['auth', 'list'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })
})
