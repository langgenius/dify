import type { Browser, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultBaseURL, defaultLocale } from '../test-env'

export type AuthSessionMetadata = {
  adminEmail: string
  baseURL: string
  mode: 'install' | 'login'
  usedInitPassword: boolean
}

export const AUTH_BOOTSTRAP_TIMEOUT_MS = 120_000
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

const escapeRegex = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

const appURL = (baseURL: string, pathname: string) => new URL(pathname, baseURL).toString()

type AuthPageState = 'install' | 'login' | 'init'

const getRemainingTimeout = (deadline: number) => Math.max(deadline - Date.now(), 1)

const waitForPageState = async (page: Page, deadline: number): Promise<AuthPageState> => {
  const installHeading = page.getByRole('heading', { name: 'Setting up an admin account' })
  const signInButton = page.getByRole('button', { name: 'Sign in' })
  const initPasswordField = page.getByLabel('Admin initialization password')

  try {
    return await Promise.any<AuthPageState>([
      installHeading
        .waitFor({ state: 'visible', timeout: getRemainingTimeout(deadline) })
        .then(() => 'install'),
      signInButton
        .waitFor({ state: 'visible', timeout: getRemainingTimeout(deadline) })
        .then(() => 'login'),
      initPasswordField
        .waitFor({ state: 'visible', timeout: getRemainingTimeout(deadline) })
        .then(() => 'init'),
    ])
  } catch {
    throw new Error(`Unable to determine auth page state for ${page.url()}`)
  }
}

const completeInitPasswordIfNeeded = async (page: Page, deadline: number) => {
  const initPasswordField = page.getByLabel('Admin initialization password')

  const needsInitPassword = await initPasswordField
    .waitFor({ state: 'visible', timeout: Math.min(getRemainingTimeout(deadline), 3_000) })
    .then(() => true)
    .catch(() => false)

  if (!needsInitPassword) return false

  await initPasswordField.fill(initPassword)
  await page.getByRole('button', { name: 'Validate' }).click()
  await expect(page.getByRole('heading', { name: 'Setting up an admin account' })).toBeVisible({
    timeout: getRemainingTimeout(deadline),
  })

  return true
}

const completeInstall = async (page: Page, baseURL: string, deadline: number) => {
  await expect(page.getByRole('heading', { name: 'Setting up an admin account' })).toBeVisible({
    timeout: getRemainingTimeout(deadline),
  })

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Username').fill(adminCredentials.name)
  await page.getByLabel('Password').fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Set up' }).click()

  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(baseURL)}/apps(?:\\?.*)?$`), {
    timeout: getRemainingTimeout(deadline),
  })
}

const completeLogin = async (page: Page, baseURL: string, deadline: number) => {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({
    timeout: getRemainingTimeout(deadline),
  })

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Password').fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(baseURL)}/apps(?:\\?.*)?$`), {
    timeout: getRemainingTimeout(deadline),
  })
}

export const ensureAuthenticatedState = async (browser: Browser, configuredBaseURL?: string) => {
  const baseURL = resolveBaseURL(configuredBaseURL)
  const deadline = Date.now() + AUTH_BOOTSTRAP_TIMEOUT_MS

  await mkdir(authDir, { recursive: true })

  const context = await browser.newContext({
    baseURL,
    locale: defaultLocale,
  })
  const page = await context.newPage()

  try {
    await page.goto(appURL(baseURL, '/install'), {
      timeout: getRemainingTimeout(deadline),
      waitUntil: 'domcontentloaded',
    })

    let usedInitPassword = await completeInitPasswordIfNeeded(page, deadline)
    let pageState = await waitForPageState(page, deadline)

    while (pageState === 'init') {
      const completedInitPassword = await completeInitPasswordIfNeeded(page, deadline)
      if (!completedInitPassword)
        throw new Error(`Unable to validate initialization password for ${page.url()}`)

      usedInitPassword = true
      pageState = await waitForPageState(page, deadline)
    }

    if (pageState === 'install') await completeInstall(page, baseURL, deadline)
    else await completeLogin(page, baseURL, deadline)

    await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible({
      timeout: getRemainingTimeout(deadline),
    })

    await context.storageState({ path: authStatePath })

    const metadata: AuthSessionMetadata = {
      adminEmail: adminCredentials.email,
      baseURL,
      mode: pageState,
      usedInitPassword,
    }

    await writeFile(authMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  } finally {
    await context.close()
  }
}
