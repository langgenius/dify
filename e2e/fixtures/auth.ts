import type { Browser } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConsoleClient } from '../support/api/console-client'
import { defaultBaseURL, defaultLocale } from '../test-env'

export type AuthSessionMetadata = {
  adminEmail: string
  baseURL: string
  mode: 'install' | 'login'
  usedInitPassword: boolean
}

export const AUTH_BOOTSTRAP_TIMEOUT_MS = 180_000
const AUTH_FLOW_TIMEOUT_MS = AUTH_BOOTSTRAP_TIMEOUT_MS - 30_000
const e2eRoot = fileURLToPath(new URL('..', import.meta.url))

export const authDir = path.join(e2eRoot, '.auth')
export const authStatePath = path.join(authDir, 'admin.json')
export const authMetadataPath = path.join(authDir, 'session.json')

export const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL || 'e2e-admin@example.com',
  name: process.env.E2E_ADMIN_NAME || 'E2E Admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin12345',
}

const initPassword = process.env.E2E_INIT_PASSWORD || 'E2eInit12345'

export const resolveBaseURL = (configuredBaseURL?: string) =>
  configuredBaseURL || process.env.E2E_BASE_URL || defaultBaseURL

export const readAuthSessionMetadata = async () => {
  const content = await readFile(authMetadataPath, 'utf8')
  return JSON.parse(content) as AuthSessionMetadata
}

type AuthBootstrapResult = {
  mode: AuthSessionMetadata['mode']
  usedInitPassword: boolean
}

const getRemainingTimeout = (deadline: number) => Math.max(deadline - Date.now(), 1)

const encodeField = (value: string) => Buffer.from(value, 'utf8').toString('base64')

const validateInitPasswordIfNeeded = async (
  client: ReturnType<typeof createConsoleClient>,
  deadline: number,
) => {
  const options = { context: { timeoutMs: getRemainingTimeout(deadline) } }
  const initStatus = await client.init.get(undefined, options)
  if (initStatus.status === 'finished') return false

  console.warn('[e2e] auth bootstrap: validating init password')
  await client.init.post({ body: { password: initPassword } }, options)
  return true
}

const ensureAdminAccount = async (
  client: ReturnType<typeof createConsoleClient>,
  deadline: number,
): Promise<AuthBootstrapResult> => {
  const options = { context: { timeoutMs: getRemainingTimeout(deadline) } }
  const setupStatus = await client.setup.get(undefined, options)
  let usedInitPassword = false

  if (setupStatus.step === 'not_started') {
    usedInitPassword = await validateInitPasswordIfNeeded(client, deadline)
    console.warn('[e2e] auth bootstrap: creating admin account')
    await client.setup.post(
      {
        body: {
          email: adminCredentials.email,
          name: adminCredentials.name,
          password: adminCredentials.password,
          language: defaultLocale,
        },
      },
      options,
    )

    return { mode: 'install', usedInitPassword }
  }

  return { mode: 'login', usedInitPassword }
}

const loginAdmin = async (client: ReturnType<typeof createConsoleClient>, deadline: number) => {
  console.warn('[e2e] auth bootstrap: logging in admin')
  await client.login.post(
    {
      body: {
        email: adminCredentials.email,
        password: encodeField(adminCredentials.password),
        remember_me: true,
      },
    },
    { context: { timeoutMs: getRemainingTimeout(deadline) } },
  )
}

export const ensureAuthenticatedState = async (browser: Browser, configuredBaseURL?: string) => {
  const baseURL = resolveBaseURL(configuredBaseURL)
  const deadline = Date.now() + AUTH_FLOW_TIMEOUT_MS

  await mkdir(authDir, { recursive: true })

  const context = await browser.newContext({
    baseURL,
    locale: defaultLocale,
  })
  const client = createConsoleClient({ requestContext: context.request, requireCsrfToken: false })

  try {
    const { mode, usedInitPassword } = await ensureAdminAccount(client, deadline)
    await loginAdmin(client, deadline)

    await context.storageState({ path: authStatePath })

    const metadata: AuthSessionMetadata = {
      adminEmail: adminCredentials.email,
      baseURL,
      mode,
      usedInitPassword,
    }

    await writeFile(authMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  } finally {
    await context.close()
  }
}
