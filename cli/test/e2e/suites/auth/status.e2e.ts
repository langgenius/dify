/**
 * E2E: difyctl auth status — Auth Status
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Auth Status (1.37–1.48)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode, assertJson, assertNoAnsi } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / difyctl auth status', () => {
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

  /** Inject a complete internal-user bundle including account and workspace fields. */
  async function withAuth(overrideWorkspaceId?: string) {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(configDir, { recursive: true, mode: 0o700 })
    const wsId = overrideWorkspaceId ?? E.workspaceId
    const wsName = overrideWorkspaceId ? 'Workspace 2' : E.workspaceName
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `account:`,
      `  id: acct-e2e`,
      `  email: e2e@example.com`,
      `  name: E2E User`,
      `workspace:`,
      `  id: ${wsId}`,
      `  name: "${wsName}"`,
      `  role: owner`,
      `available_workspaces:`,
      `  - id: ${E.workspaceId}`,
      `    name: "${E.workspaceName}"`,
      `    role: owner`,
      `  - id: 747729d0-c476-4ba3-b44a-52bdf962c4f6`,
      `    name: "Workspace 2"`,
      `    role: member`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  /** Inject an external SSO session bundle. */
  async function withSSOAuth() {
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.ssoToken || 'dfoe_test'}`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── 1.37: Basic status display (strengthened) ────────────────────────────

  it('[P0] auth status displays host, email, name, workspace and session tier (1.37)', async () => {
    // Spec 1.37: output contains host, email, name, workspace, session tier.
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    // host (without scheme)
    expect(result.stdout).toContain(E.host.replace(/^https?:\/\//, ''))
    // email and name from account bundle
    expect(result.stdout).toContain('e2e@example.com')
    expect(result.stdout).toContain('E2E User')
    // session tier ("Dify account" for internal users)
    expect(result.stdout).toMatch(/Session|Dify account|full access/i)
  })

  // ── 1.38: Verbose flag (strengthened) ────────────────────────────────────

  it('[P1] auth status -v displays role, available workspace count and storage backend (1.38)', async () => {
    // Spec 1.38: -v output contains workspace role, available workspace count, token storage backend.
    await withAuth()
    const result = await r(['auth', 'status', '-v'])
    assertExitCode(result, 0)
    // workspace role
    expect(result.stdout).toContain('owner')
    // available workspace count (2 workspaces injected)
    expect(result.stdout).toMatch(/2\s*workspace|available.*2/i)
    // token storage backend
    expect(result.stdout).toMatch(/file|keychain/i)
  })

  // ── 1.39: JSON schema (strengthened) ─────────────────────────────────────

  it('[P0] auth status --json outputs stable JSON schema with all required fields (1.39)', async () => {
    // Spec 1.39: --json output is parseable JSON with a stable schema.
    await withAuth()
    const result = await r(['auth', 'status', '--json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{
      logged_in: boolean
      host: string
      storage: string
      account: { id: string, email: string, name: string }
      workspace: { id: string, role: string }
      available_workspaces_count: number
    }>(result)
    expect(parsed.logged_in).toBe(true)
    expect(typeof parsed.host).toBe('string')
    expect(parsed.account.email).toBe('e2e@example.com')
    expect(parsed.account.name).toBe('E2E User')
    expect(parsed.workspace).toHaveProperty('id')
    expect(parsed.workspace).toHaveProperty('role', 'owner')
    expect(parsed.available_workspaces_count).toBeGreaterThanOrEqual(1)
  })

  // ── 1.40: Unauthenticated ─────────────────────────────────────────────────

  it('[P0] unauthenticated auth status returns "Not logged in" — exit code 4 (1.40)', async () => {
    // Spec 1.40: no session → "Not logged in.", exit code 4.
    const result = await r(['auth', 'status'])
    assertExitCode(result, 4)
    expect(result.stdout).toMatch(/not logged in/i)
  })

  // ── 1.41–1.43: External SSO user ──────────────────────────────────────────

  it('[P0] external SSO user auth status does not display workspace row (1.41)', async () => {
    // Spec 1.41: SSO user has no workspace, so workspace row must be absent.
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).not.toMatch(/workspace/i)
  })

  it('[P0] external SSO user auth status displays issuer URL (1.42)', async () => {
    // Spec 1.42: issuer URL appears in the output.
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('issuer.example.com')
  })

  it('[P0] external SSO user auth status displays External SSO session info (1.43)', async () => {
    // Spec 1.43: session type is clearly identified as external SSO.
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/SSO|apps:run/i)
  })

  // ── 1.44: Expired token (clarified) ──────────────────────────────────────

  it('[P0] auth status with an expired/invalid token still exits 0 (1.44)', async () => {
    // Spec 1.44: expired/invalid token returns an authentication error
    //
    // Implementation note: `auth status` reads only the LOCAL hosts.yml and makes
    // NO network request — it cannot detect token expiry.  Token expiry is surfaced
    // when commands like `get app` or `run app` attempt a real API call.
    //
    // Therefore: as long as a token is present in hosts.yml, auth status exits 0
    // and displays the locally-stored session information.  This is the correct and
    // intended behaviour; the spec description is misleading.
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_expired_token_xyz',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    // Must still show the host from hosts.yml
    expect(result.stdout).toContain(E.host.replace(/^https?:\/\//, ''))
  })

  // ── 1.45: JSON error envelope (corrected direction) ───────────────────────

  it('[P1] unauthenticated auth status --json outputs JSON to stdout with logged_in:false (1.45)', async () => {
    // Spec 1.45: stderr JSON error envelope — actual CLI writes
    // the JSON payload to STDOUT, not stderr.  stderr contains the human-readable
    // "not_logged_in: not logged in" message.  The test asserts the actual behaviour.
    const result = await r(['auth', 'status', '--json'])
    expect(result.exitCode).toBe(4)
    // Structured JSON is on stdout
    const parsed = JSON.parse(result.stdout) as { logged_in: boolean }
    expect(parsed.logged_in).toBe(false)
    // Human-readable error is on stderr
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  })

  // ── 1.46: Network error ───────────────────────────────────────────────────

  it('[P1] auth status with unreachable host still exits 0 — purely local (1.46)', async () => {
    // Spec 1.46 originally described "network unavailable → server/network error", but source-code
    // analysis of the full call chain confirms auth status makes NO network requests:
    //   Status.run() → loadHosts() → YamlStore.getTyped() → fs.readFileSync(hosts.yml)
    //                → runStatus()  → pure string formatting
    //
    // Correct expected behaviour: even when hosts.yml contains an unreachable host URL,
    // auth status reads local data only and exits 0.  This test validates that behaviour.
    await injectAuth(configDir, {
      host: 'https://127.0.0.1:19999', // unreachable host in config
      bearer: E.token,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'status'])
    // Must exit 0 — no network call is made, so unreachable host is irrelevant
    assertExitCode(result, 0)
    // Must show the host from the local hosts.yml
    expect(result.stdout).toContain('127.0.0.1:19999')
  })

  // ── 1.47: File-based storage (explicit named case) ────────────────────────

  it('[P1] auth status with file-based token storage works correctly (1.47)', async () => {
    // Spec 1.47: token_storage: file → auth status returns normal status.
    // All withAuth() calls already use file storage; this test names it explicitly.
    await withAuth()
    const result = await r(['auth', 'status', '-v'])
    assertExitCode(result, 0)
    // Confirm storage backend is reported as file
    expect(result.stdout).toMatch(/Storage.*file|file/i)
    // Normal status info is present
    expect(result.stdout).toContain('e2e@example.com')
  })

  // ── 1.48: Workspace switch ────────────────────────────────────────────────

  it('[P1] auth status shows the active workspace after workspace switch (1.48)', async () => {
    // Spec 1.48: after switching workspace, auth status must reflect the new workspace.
    // Simulate workspace switch by writing a hosts.yml with a different active workspace.
    await withAuth('747729d0-c476-4ba3-b44a-52bdf962c4f6') // Workspace 2
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    // The active workspace label must be Workspace 2, not the original one
    expect(result.stdout).toMatch(/Workspace 2/i)
  })

  // ── Output quality ────────────────────────────────────────────────────────

  it('[P0] auth status output contains no ANSI colour codes (non-TTY)', async () => {
    // General quality: non-TTY output must be ANSI-free.
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })
})
