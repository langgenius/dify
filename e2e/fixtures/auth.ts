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

const WAIT_TIMEOUT_MS = 120_000
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

const waitForPageState = async (page: Page) => {
  const installHeading = page.getByRole('heading', { name: 'Setting up an admin account' })
  const signInButton = page.getByRole('button', { name: 'Sign in' })
  const initPasswordField = page.getByLabel('Admin initialization password')

  const deadline = Date.now() + WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await installHeading.isVisible().catch(() => false)) return 'install' as const
    if (await signInButton.isVisible().catch(() => false)) return 'login' as const
    if (await initPasswordField.isVisible().catch(() => false)) return 'init' as const

    await page.waitForTimeout(1_000)
  }

  throw new Error(`Unable to determine auth page state for ${page.url()}`)
}

const completeInitPasswordIfNeeded = async (page: Page) => {
  const initPasswordField = page.getByLabel('Admin initialization password')
  if (!(await initPasswordField.isVisible({ timeout: 3_000 }).catch(() => false))) return false

  await initPasswordField.fill(initPassword)
  await page.getByRole('button', { name: 'Validate' }).click()
  await expect(page.getByRole('heading', { name: 'Setting up an admin account' })).toBeVisible({
    timeout: WAIT_TIMEOUT_MS,
  })

  return true
}

const completeInstall = async (page: Page, baseURL: string) => {
  await expect(page.getByRole('heading', { name: 'Setting up an admin account' })).toBeVisible({
    timeout: WAIT_TIMEOUT_MS,
  })

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Username').fill(adminCredentials.name)
  await page.getByLabel('Password').fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Set up' }).click()

  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(baseURL)}/apps(?:\\?.*)?$`), {
    timeout: WAIT_TIMEOUT_MS,
  })
}

const completeLogin = async (page: Page, baseURL: string) => {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({
    timeout: WAIT_TIMEOUT_MS,
  })

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Password').fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(baseURL)}/apps(?:\\?.*)?$`), {
    timeout: WAIT_TIMEOUT_MS,
  })
}

export const ensureAuthenticatedState = async (browser: Browser, configuredBaseURL?: string) => {
  const baseURL = resolveBaseURL(configuredBaseURL)

  await mkdir(authDir, { recursive: true })

  const context = await browser.newContext({
    baseURL,
    locale: defaultLocale,
  })
  const page = await context.newPage()

  try {
    await page.goto(appURL(baseURL, '/install'), { waitUntil: 'networkidle' })

    let usedInitPassword = await completeInitPasswordIfNeeded(page)
    let pageState = await waitForPageState(page)

    while (pageState === 'init') {
      const completedInitPassword = await completeInitPasswordIfNeeded(page)
      if (!completedInitPassword)
        throw new Error(`Unable to validate initialization password for ${page.url()}`)

      usedInitPassword = true
      pageState = await waitForPageState(page)
    }

    if (pageState === 'install') await completeInstall(page, baseURL)
    else await completeLogin(page, baseURL)

    await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible({
      timeout: WAIT_TIMEOUT_MS,
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
