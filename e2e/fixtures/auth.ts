import type { APIResponse, Browser, BrowserContext } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForConsoleHome } from '../support/home'
import { apiURL, defaultBaseURL, defaultLocale } from '../test-env'

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

const appURL = (baseURL: string, pathname: string) => new URL(pathname, baseURL).toString()
const apiEndpoint = (pathname: string) => new URL(pathname, apiURL).toString()

type SetupStatusResponse = {
  step: 'not_started' | 'finished'
}

type InitStatusResponse = {
  status: 'not_started' | 'finished'
}

type AuthBootstrapResult = {
  mode: AuthSessionMetadata['mode']
  usedInitPassword: boolean
}

const getRemainingTimeout = (deadline: number) => Math.max(deadline - Date.now(), 1)

const encodeField = (value: string) => Buffer.from(value, 'utf8').toString('base64')

const assertAPIResponse = async (response: APIResponse, action: string) => {
  if (response.ok())
    return

  const body = await response.text().catch(() => '')
  throw new Error(
    `${action} failed with ${response.status()} ${response.statusText()}${body ? `: ${body}` : ''}`,
  )
}

const getConsoleAPI = async <T>(context: BrowserContext, pathname: string, deadline: number) => {
  const response = await context.request.get(apiEndpoint(pathname), {
    timeout: getRemainingTimeout(deadline),
  })
  await assertAPIResponse(response, `GET ${pathname}`)
  return response.json() as Promise<T>
}

const postConsoleAPI = async (
  context: BrowserContext,
  pathname: string,
  deadline: number,
  data: Record<string, unknown>,
) => {
  const response = await context.request.post(apiEndpoint(pathname), {
    data,
    timeout: getRemainingTimeout(deadline),
  })
  await assertAPIResponse(response, `POST ${pathname}`)
}

const validateInitPasswordIfNeeded = async (context: BrowserContext, deadline: number) => {
  const initStatus = await getConsoleAPI<InitStatusResponse>(context, '/console/api/init', deadline)
  if (initStatus.status === 'finished')
    return false

  console.warn('[e2e] auth bootstrap: validating init password')
  await postConsoleAPI(context, '/console/api/init', deadline, { password: initPassword })
  return true
}

const ensureAdminAccount = async (
  context: BrowserContext,
  deadline: number,
): Promise<AuthBootstrapResult> => {
  const setupStatus = await getConsoleAPI<SetupStatusResponse>(
    context,
    '/console/api/setup',
    deadline,
  )
  let usedInitPassword = false

  if (setupStatus.step === 'not_started') {
    usedInitPassword = await validateInitPasswordIfNeeded(context, deadline)
    console.warn('[e2e] auth bootstrap: creating admin account')
    await postConsoleAPI(context, '/console/api/setup', deadline, {
      email: adminCredentials.email,
      name: adminCredentials.name,
      password: adminCredentials.password,
      language: defaultLocale,
    })

    return { mode: 'install', usedInitPassword }
  }

  return { mode: 'login', usedInitPassword }
}

const loginAdmin = async (context: BrowserContext, deadline: number) => {
  console.warn('[e2e] auth bootstrap: logging in admin')
  await postConsoleAPI(context, '/console/api/login', deadline, {
    email: adminCredentials.email,
    password: encodeField(adminCredentials.password),
    remember_me: true,
  })
}

export const ensureAuthenticatedState = async (browser: Browser, configuredBaseURL?: string) => {
  const baseURL = resolveBaseURL(configuredBaseURL)
  const deadline = Date.now() + AUTH_FLOW_TIMEOUT_MS

  await mkdir(authDir, { recursive: true })

  const context = await browser.newContext({
    baseURL,
    locale: defaultLocale,
  })
  const page = await context.newPage()

  try {
    const { mode, usedInitPassword } = await ensureAdminAccount(context, deadline)
    await loginAdmin(context, deadline)

    console.warn('[e2e] auth bootstrap: verifying console home')
    await page.goto(appURL(baseURL, '/'), {
      timeout: getRemainingTimeout(deadline),
      waitUntil: 'domcontentloaded',
    })
    await waitForConsoleHome(page, getRemainingTimeout(deadline))

    await context.storageState({ path: authStatePath })

    const metadata: AuthSessionMetadata = {
      adminEmail: adminCredentials.email,
      baseURL,
      mode,
      usedInitPassword,
    }

    await writeFile(authMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  }
  finally {
    await context.close()
  }
}
