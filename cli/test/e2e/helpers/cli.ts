/**
 * E2E CLI runner helpers.
 *
 * Core primitive:  run(argv, opts) → { stdout, stderr, exitCode }
 *
 * The binary is invoked via `bun bin/dev.js` so tests work without a prior
 * `pnpm build`.  Each test should use its own isolated configDir (created via
 * withTempConfig) to prevent session state leaking between tests.
 */

import { Buffer } from 'node:buffer'
import { execSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Path to the dev entry point — no build required. */
export const BIN = resolve(__dirname, '../../../bin/dev.js')

/**
 * Resolve the `bun` executable path.
 * Priority: PATH → ~/.bun/bin/bun → /usr/local/bin/bun
 */
function resolveBun(): string {
  const candidates = [
    // Respect PATH first
    'bun',
    // Common install locations
    `${process.env.HOME}/.bun/bin/bun`,
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ]
  for (const candidate of candidates) {
    try {
      execSync(`${candidate} --version`, { stdio: 'ignore', timeout: 3000 })
      return candidate
    }
    catch { /* try next */ }
  }
  throw new Error(
    'bun not found. Install it with: curl -fsSL https://bun.sh/install | bash',
  )
}

export const BUN = resolveBun()

// ── Types ─────────────────────────────────────────────────────────────────

export type RunOptions = {
  /**
   * Override or extend the process environment.
   * Values are merged on top of `process.env`.
   */
  env?: Record<string, string>
  /**
   * Path to an isolated config directory.
   * The CLI reads hosts.yml from this directory.
   * Passed as DIFY_CONFIG_DIR env var.
   */
  configDir?: string
  /** Maximum time to wait for the process, in ms. Default: 30 000 */
  timeout?: number
  /** String to write to stdin, then close the pipe. */
  stdin?: string
}

export type RunResult = {
  stdout: string
  stderr: string
  exitCode: number
}

// ── Core runner ────────────────────────────────────────────────────────────

/**
 * Execute `difyctl <argv>` and return the captured stdout, stderr and exit code.
 *
 * Environment notes:
 *  - CI=1 suppresses interactive prompts and spinners.
 *  - NO_COLOR=1 strips ANSI escape codes from output.
 *  - DIFY_CONFIG_DIR is set to opts.configDir when provided.
 */
export function run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      // Suppress interactive prompts in all E2E tests.
      CI: '1',
      NO_COLOR: '1',
      // Force file-based token storage to avoid macOS keychain UI prompts
      // blocking child processes spawned by vitest workers.
      DIFY_E2E_NO_KEYRING: '1',
      // Point the CLI at the isolated config directory.
      ...(opts.configDir !== undefined ? { DIFY_CONFIG_DIR: opts.configDir } : {}),
      ...opts.env,
    }

    const proc = spawn(BUN, [BIN, ...argv], { env })
    const timeoutMs = opts.timeout ?? 60_000
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      proc.kill('SIGINT')
      setTimeout(() => proc.kill('SIGKILL'), 2000).unref?.()
    }, timeoutMs)
    timeoutId.unref?.()

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    if (opts.stdin !== undefined) {
      proc.stdin.write(opts.stdin)
      proc.stdin.end()
    }

    proc.on('close', (code: number | null) => {
      clearTimeout(timeoutId)
      resolve({ stdout, stderr, exitCode: code ?? (timedOut ? 124 : 1) })
    })

    proc.on('error', (err: Error) => {
      clearTimeout(timeoutId)
      reject(new Error(`Failed to spawn CLI process: ${err.message}`))
    })
  })
}

// ── Config directory helpers ───────────────────────────────────────────────

export type TempConfig = {
  /** Path to the isolated config directory. */
  configDir: string
  /** Remove the directory and all its contents. */
  cleanup: () => Promise<void>
}

/**
 * Create a fresh temporary config directory for a single test.
 * Always call cleanup() in afterEach to avoid leaking temp directories.
 */
export async function withTempConfig(): Promise<TempConfig> {
  const configDir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-'))
  return {
    configDir,
    cleanup: () => rm(configDir, { recursive: true, force: true }),
  }
}

// ── Auth injection ─────────────────────────────────────────────────────────

export type AuthInjectionOptions = {
  /** Staging server base URL (no trailing slash). */
  host: string
  /** Bearer token — dfoa_ for internal, dfoe_ for SSO. */
  bearer: string
  /** Account email — written into hosts.yml and used as the token store key. */
  email?: string
  /** Account display name. Defaults to the email local part. */
  accountName?: string
  /** Account ID written into hosts.yml when a test needs it. */
  accountId?: string
  /** Primary workspace to write into the bundle. */
  workspaceId: string
  workspaceName: string
  workspaceRole?: string
  /** Full available workspace list. Defaults to the primary workspace only. */
  availableWorkspaces?: Array<{ id: string, name: string, role: string }>
  /**
   * Server-side session UUID (OAuthAccessToken.id).
   * When provided, written as `token_id` in hosts.yml so that
   * `devices revoke` can correctly detect selfHit and clear local credentials.
   */
  tokenId?: string
}

export type SsoAuthInjectionOptions = {
  host: string
  bearer: string
  email?: string
  issuer?: string
}

function splitHost(host: string): { bare: string, scheme: string } {
  const bare = (() => {
    try {
      return new URL(host).host || host
    }
    catch {
      return host
    }
  })()
  const scheme = (() => {
    try {
      return new URL(host).protocol.replace(':', '')
    }
    catch {
      return 'https'
    }
  })()
  return { bare, scheme }
}

async function writeFileToken(configDir: string, host: string, email: string, bearer: string): Promise<void> {
  const dotParts = `tokens.${host}.${email}`.split('.')
  let yaml = ''
  for (let i = 0; i < dotParts.length - 1; i++) {
    yaml += `${'  '.repeat(i) + dotParts[i]}:\n`
  }
  yaml += `${'  '.repeat(dotParts.length - 1) + (dotParts[dotParts.length - 1] ?? '')}: "${bearer}"\n`
  await writeFile(join(configDir, 'tokens.yml'), yaml, { mode: 0o600 })
}

/**
 * Write a pre-baked hosts.yml into configDir so tests can skip the real
 * Device-Flow login.  Auth-specific E2E tests (login/logout/status) use the
 * real flow and should NOT call this function.
 */
export async function injectAuth(configDir: string, opts: AuthInjectionOptions): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 })

  const role = opts.workspaceRole ?? 'owner'

  // ── Derive bare host and scheme ───────────────────────────────────────────
  // difyctl stores the bare hostname (no scheme) as the registry key.
  // The scheme is stored separately in the host entry so hostWithScheme()
  // can reconstruct the full URL. Without scheme, difyctl defaults to https.
  const { bare, scheme } = splitHost(opts.host)
  const email = opts.email ?? 'e2e@example.com'
  const accountName = opts.accountName ?? email.split('@')[0] ?? ''
  const availableWorkspaces = opts.availableWorkspaces ?? [{
    id: opts.workspaceId,
    name: opts.workspaceName,
    role,
  }]

  // ── hosts.yml ────────────────────────────────────────────────────────────
  // difyctl 0.1.0-rc.1 uses a nested registry format:
  //   token_storage / current_host / hosts.<bareHost>.accounts.<email>.(workspace|...)
  // On macOS (keychain available) difyctl always uses the OS keychain for tokens.
  // We probe keychain availability the same way difyctl does: try a round-trip.
  // Always use file-based storage in E2E tests to avoid macOS keychain
  // UI prompts that block CLI child processes spawned by vitest workers.
  const canUseKeychain = false
  const storageMode = 'file' as const

  const hostsYml = `${[
    `token_storage: ${storageMode}`,
    `current_host: ${bare}`,
    `hosts:`,
    `  ${bare}:`,
    ...(scheme !== 'https' ? [`    scheme: ${scheme}`] : []),
    `    current_account: ${email}`,
    `    accounts:`,
    `      ${email}:`,
    `        account:`,
    ...(opts.accountId !== undefined ? [`          id: ${opts.accountId}`] : []),
    `          email: ${email}`,
    `          name: ${accountName}`,
    ...(opts.tokenId !== undefined ? [`        token_id: ${opts.tokenId}`] : []),
    `        workspace:`,
    `          id: ${opts.workspaceId}`,
    `          name: "${opts.workspaceName}"`,
    `          role: ${role}`,
    `        available_workspaces:`,
    ...availableWorkspaces.flatMap(workspace => [
      `          - id: ${workspace.id}`,
      `            name: "${workspace.name}"`,
      `            role: ${workspace.role}`,
    ]),
  ].join('\n')}\n`

  await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

  // ── Store bearer token ────────────────────────────────────────────────────
  // Token storage key: tokens.<bareHost>.<email>  (dot-path for YamlStore.doGet)
  if (canUseKeychain) {
    // Write to OS keychain using the same service+account that difyctl uses:
    //   service = "difyctl", account = tokenKey = "tokens.<bareHost>.<email>"
    // KeyringBasedStore.set JSON-encodes the value before storing.
    const { Entry } = await import('@napi-rs/keyring')
    const account = `tokens.${bare}.${email}`
    new Entry('difyctl', account).setPassword(JSON.stringify(opts.bearer))
  }
  else {
    // Fall back to tokens.yml.
    // YamlStore.doGet splits the key on '.' and traverses the nested object,
    // so "tokens.localhost.user@dify.ai" splits into 4 parts:
    //   tokens -> localhost -> user@dify -> ai
    // The YAML must mirror that exact nesting.
    await writeFileToken(configDir, bare, email, opts.bearer)
  }
}

export async function injectSsoAuth(configDir: string, opts: SsoAuthInjectionOptions): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 })

  const { bare, scheme } = splitHost(opts.host)
  const email = opts.email ?? 'sso@example.com'
  const issuer = opts.issuer ?? 'https://issuer.example.com'
  const hostsYml = `${[
    `token_storage: file`,
    `current_host: ${bare}`,
    `hosts:`,
    `  ${bare}:`,
    ...(scheme !== 'https' ? [`    scheme: ${scheme}`] : []),
    `    current_account: ${email}`,
    `    accounts:`,
    `      ${email}:`,
    `        account:`,
    `          email: ""`,
    `          name: ""`,
    `        external_subject:`,
    `          email: ${email}`,
    `          issuer: ${issuer}`,
  ].join('\n')}\n`

  await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  await writeFileToken(configDir, bare, email, opts.bearer)
}

// ── Process signal helpers ─────────────────────────────────────────────────

export type SpawnedProcess = {
  /** Send SIGINT (Ctrl+C) to the process. */
  interrupt: () => void
  /** Wait for the process to exit and return the result. */
  wait: () => Promise<RunResult>
}

/**
 * Start `difyctl <argv>` in the background without waiting for it to finish.
 * Useful for testing interrupt / timeout behaviour.
 */
export function spawn_background(argv: string[], opts: RunOptions = {}): SpawnedProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CI: '1',
    NO_COLOR: '1',
    ...(opts.configDir !== undefined ? { DIFY_CONFIG_DIR: opts.configDir } : {}),
    ...opts.env,
  }

  const proc = spawn(BUN, [BIN, ...argv], { env })
  const timeoutMs = opts.timeout ?? 60_000
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    proc.kill('SIGINT')
    setTimeout(() => proc.kill('SIGKILL'), 2000).unref?.()
  }, timeoutMs)
  timeoutId.unref?.()

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  return {
    interrupt: () => { proc.kill('SIGINT') },
    wait: () => new Promise((res) => {
      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId)
        res({ stdout, stderr, exitCode: code ?? (timedOut ? 124 : 1) })
      })
    }),
  }
}

// ── Auth fixture ───────────────────────────────────────────────────────────

export type AuthFixture = {
  /** Path to the isolated config directory, pre-loaded with a valid session. */
  configDir: string
  /**
   * Run `difyctl <argv>` using the fixture's config dir.
   * Shorthand for `run(argv, { configDir, env })`.
   */
  r: (argv: string[], extraEnv?: Record<string, string>) => Promise<RunResult>
  /** Remove the temp config directory. Call in afterEach. */
  cleanup: () => Promise<void>
}

/**
 * Create an isolated config directory pre-loaded with a valid internal-user
 * session.  Designed for use with vitest's beforeEach / afterEach:
 *
 * @example
 * let fx: AuthFixture
 * beforeEach(async () => { fx = await withAuthFixture(E) })
 * afterEach(async () => { await fx.cleanup() })
 *
 * it('...', async () => {
 *   const result = await fx.r(['get', 'app'])
 *   assertExitCode(result, 0)
 * })
 */
export async function withAuthFixture(
  E: { host: string, token: string, workspaceId: string, workspaceName: string, email?: string },
): Promise<AuthFixture> {
  const { configDir, cleanup } = await withTempConfig()
  await injectAuth(configDir, {
    host: E.host,
    bearer: E.token,
    email: E.email,
    workspaceId: E.workspaceId,
    workspaceName: E.workspaceName,
  })
  return {
    configDir,
    r: (argv, extraEnv) => run(argv, { configDir, env: extraEnv }),
    cleanup,
  }
}

// ── On-demand disposable token ─────────────────────────────────────────────

/**
 * Mint a fresh dfoa_ OAuth token on demand via the 3-step device flow API.
 * Use this inside tests that need to revoke a real session without consuming
 * the shared DIFY_E2E_TOKEN or the global-setup disposableToken.
 *
 * Requires DIFY_E2E_EMAIL and DIFY_E2E_PASSWORD to be set.
 * Returns empty string if credentials are missing.
 *
 * Steps:
 *  1. POST /console/api/login (Base64 password) → session cookie
 *  2. POST /openapi/v1/oauth/device/code        → device_code + user_code
 *  3. POST /openapi/v1/oauth/device/approve     → approved
 *  4. POST /openapi/v1/oauth/device/token       → dfoa_ token
 */
export async function mintFreshToken(
  host: string,
  email: string,
  password: string,
): Promise<string> {
  if (!email || !password)
    return ''

  const base = host.replace(/\/$/, '')
  const sig = AbortSignal.timeout(15_000)

  // Step 1 — console login
  const passwordB64 = Buffer.from(password, 'utf8').toString('base64')
  const loginRes = await fetch(`${base}/console/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwordB64, remember_me: false }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!loginRes.ok)
    return ''

  const setCookieHeaders = loginRes.headers.getSetCookie?.() ?? []
  const cookieString = setCookieHeaders.map(c => c.split(';')[0]).join('; ')
  const csrfMatch = cookieString.match(/csrf_token=([^;]+)/)
  const csrfToken = csrfMatch ? csrfMatch[1] : ''

  // Step 2 — device code
  const codeRes = await fetch(`${base}/openapi/v1/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'difyctl', device_label: 'e2e-fresh' }),
    signal: sig,
  })
  if (!codeRes.ok)
    return ''
  const { device_code, user_code } = await codeRes.json() as { device_code: string, user_code: string }

  // Step 3 — approve
  const approveRes = await fetch(`${base}/openapi/v1/oauth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieString, 'X-CSRFToken': csrfToken },
    body: JSON.stringify({ user_code }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!approveRes.ok)
    return ''

  // Step 4 — poll token
  const tokenRes = await fetch(`${base}/openapi/v1/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code, client_id: 'difyctl' }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!tokenRes.ok)
    return ''
  const body = await tokenRes.json() as { token?: string }
  return body.token ?? ''
}
