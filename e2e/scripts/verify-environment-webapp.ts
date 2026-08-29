import type { APIRequestContext, BrowserContext, Page, Response } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import { e2eDir } from './common'

const environmentWebAppURL = process.env.E2E_ENVIRONMENT_WEBAPP_URL
const headless = process.env.E2E_HEADED !== '1'
const passportHeader = 'X-App-Passport'
const appCodeHeader = 'X-App-Code'

type SitePayload = {
  app_id: string
  end_user_id: string
}

type PassportPayload = {
  access_token: string
}

type NetworkRecord = {
  method: string
  path: string
  status: number
}

const requireEnvironmentWebAppURL = () => {
  if (!environmentWebAppURL)
    throw new Error('E2E_ENVIRONMENT_WEBAPP_URL must point to /environment/<route>/<app-code>.')

  const url = new URL(environmentWebAppURL)
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 3 || segments[0] !== 'environment')
    throw new Error('E2E_ENVIRONMENT_WEBAPP_URL must use /environment/<route>/<app-code>.')

  return { url, appCode: segments[2]! }
}

const readJSON = async <T>(response: Response) => (await response.json()) as T

const waitForSite = async (page: Page, appCode: string) => {
  const response = await page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return url.pathname === `/api/environment/${appCode}/site`
  })
  expect(response.status()).toBe(200)
  return readJSON<SitePayload>(response)
}

const environmentHeaders = (appCode: string, passport?: string) => ({
  [appCodeHeader]: appCode,
  ...(passport ? { [passportHeader]: passport } : {}),
})

const getJSON = async <T>(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
) => {
  const response = await request.get(url, { headers })
  return { response, payload: (await response.json()) as T }
}

const issuePassport = async (
  context: BrowserContext,
  origin: string,
  appCode: string,
  current?: string,
) => {
  const { response, payload } = await getJSON<PassportPayload>(
    context.request,
    `${origin}/api/environment/${appCode}/passport`,
    environmentHeaders(appCode, current),
  )
  expect(response.status()).toBe(200)
  expect(payload.access_token).toBeTruthy()
  return payload.access_token
}

const loadSite = async (
  context: BrowserContext,
  origin: string,
  appCode: string,
  passport: string,
) => {
  const { response, payload } = await getJSON<SitePayload>(
    context.request,
    `${origin}/api/environment/${appCode}/site`,
    environmentHeaders(appCode, passport),
  )
  expect(response.status()).toBe(200)
  expect(payload.end_user_id).toMatch(/^[0-9a-f-]{36}$/i)
  return payload
}

const verifyConversationOwnership = async (
  ownerContext: BrowserContext,
  otherContext: BrowserContext,
  origin: string,
  appCode: string,
  ownerPassport: string,
  otherPassport: string,
  ownerEndUserID: string,
) => {
  const created = await ownerContext.request.post(
    `${origin}/api/environment/${appCode}/chat-messages`,
    {
      headers: environmentHeaders(appCode, ownerPassport),
      data: {
        inputs: {},
        query: `environment webapp harness ${randomUUID()}`,
        response_mode: 'blocking',
        user: ownerEndUserID,
      },
    },
  )
  expect(created.status()).toBe(200)
  const createdPayload = (await created.json()) as { conversation_id?: string }
  expect(createdPayload.conversation_id).toMatch(/^[0-9a-f-]{36}$/i)
  const conversationID = createdPayload.conversation_id!

  const messagesURL = `${origin}/api/environment/${appCode}/messages?conversation_id=${conversationID}&limit=20&last_id=`
  const ownerMessages = await ownerContext.request.get(messagesURL, {
    headers: environmentHeaders(appCode, ownerPassport),
  })
  expect(ownerMessages.status()).toBe(200)

  const otherMessages = await otherContext.request.get(messagesURL, {
    headers: environmentHeaders(appCode, otherPassport),
  })
  expect(otherMessages.status()).toBe(404)
  const error = (await otherMessages.json()) as { reason?: string }
  expect(error.reason).toBe('APPDEPLOY_CONVERSATION_NOT_FOUND')
  return { conversationID }
}

const seedForeignConversationSelections = async (
  page: Page,
  appCode: string,
  site: SitePayload,
  foreignEndUserID: string,
) => {
  const builtInConversationID = randomUUID()
  const foreignEnvironmentConversationID = randomUUID()
  await page.evaluate(
    ({ appCode, appID, endUserID, foreignEndUserID, builtInID, foreignEnvironmentID }) => {
      for (const key of ['conversationIdInfo', 'tabConversationIdInfo']) {
        const storage = key === 'conversationIdInfo' ? localStorage : sessionStorage
        const current = JSON.parse(storage.getItem(key) || '{}')
        current[appID] = {
          ...(typeof current[appID] === 'object' ? current[appID] : {}),
          [endUserID]: builtInID,
          DEFAULT: builtInID,
        }
        const environmentScope = `environment:${appCode}`
        current[environmentScope] = {
          ...(typeof current[environmentScope] === 'object' ? current[environmentScope] : {}),
          [foreignEndUserID]: foreignEnvironmentID,
          DEFAULT: foreignEnvironmentID,
        }
        storage.setItem(key, JSON.stringify(current))
      }
    },
    {
      appCode,
      appID: site.app_id,
      endUserID: site.end_user_id,
      foreignEndUserID,
      builtInID: builtInConversationID,
      foreignEnvironmentID: foreignEnvironmentConversationID,
    },
  )
  return { builtInConversationID, foreignEnvironmentConversationID }
}

const main = async () => {
  const { url, appCode } = requireEnvironmentWebAppURL()
  const artifactDirectory = path.join(
    e2eDir,
    'cucumber-report',
    'environment-webapp-harness',
    new Date().toISOString().replaceAll(/[:.]/g, '-'),
  )
  await mkdir(artifactDirectory, { recursive: true })

  const browser = await chromium.launch({ headless })
  const ownerContext = await browser.newContext()
  const otherContext = await browser.newContext()
  const page = await ownerContext.newPage()
  const network: NetworkRecord[] = []
  page.on('response', (response) => {
    const responseURL = new URL(response.url())
    if (!responseURL.pathname.startsWith('/api/')) return
    network.push({
      method: response.request().method(),
      path: `${responseURL.pathname}${responseURL.search}`,
      status: response.status(),
    })
  })

  try {
    const sitePromise = waitForSite(page, appCode)
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const browserSite = await sitePromise
    expect(browserSite.end_user_id).toMatch(/^[0-9a-f-]{36}$/i)

    const pagePassport = await page.evaluate(
      (code) => localStorage.getItem(`passport-environment:${code}`),
      appCode,
    )
    expect(pagePassport).toBeTruthy()

    await page.evaluate((code) => {
      localStorage.removeItem(`passport-environment:${code}`)
    }, appCode)
    const renewedSitePromise = waitForSite(page, appCode)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    const renewedBrowserSite = await renewedSitePromise
    expect(renewedBrowserSite.end_user_id).toBe(browserSite.end_user_id)
    const renewedPagePassport = await page.evaluate(
      (code) => localStorage.getItem(`passport-environment:${code}`),
      appCode,
    )
    expect(renewedPagePassport).toBeTruthy()

    const ownerPassport = await issuePassport(
      ownerContext,
      url.origin,
      appCode,
      renewedPagePassport!,
    )
    const ownerSite = await loadSite(ownerContext, url.origin, appCode, ownerPassport)
    expect(ownerSite.end_user_id).toBe(browserSite.end_user_id)
    const refreshedPassport = await issuePassport(ownerContext, url.origin, appCode, ownerPassport)
    const refreshedSite = await loadSite(ownerContext, url.origin, appCode, refreshedPassport)
    expect(refreshedSite.end_user_id).toBe(ownerSite.end_user_id)

    const otherPassport = await issuePassport(otherContext, url.origin, appCode)
    const otherSite = await loadSite(otherContext, url.origin, appCode, otherPassport)
    expect(otherSite.end_user_id).not.toBe(ownerSite.end_user_id)
    const ownership = await verifyConversationOwnership(
      ownerContext,
      otherContext,
      url.origin,
      appCode,
      refreshedPassport,
      otherPassport,
      ownerSite.end_user_id,
    )

    const staleSelections = await seedForeignConversationSelections(
      page,
      appCode,
      browserSite,
      otherSite.end_user_id,
    )
    const reloadStart = network.length
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 })
    const reloadNetwork = network.slice(reloadStart)
    for (const conversationID of Object.values(staleSelections))
      expect(reloadNetwork.some(({ path }) => path.includes(conversationID))).toBe(false)
    expect(reloadNetwork.some(({ path }) => path.startsWith('/api/messages'))).toBe(false)
    const environmentChatRequests = reloadNetwork.filter(({ path }) =>
      /\/(messages|conversations)(\?|$)/.test(path),
    )
    expect(
      environmentChatRequests.every(({ path }) => path.startsWith(`/api/environment/${appCode}/`)),
    ).toBe(true)

    const deleted = await ownerContext.request.delete(
      `${url.origin}/api/environment/${appCode}/conversations/${ownership.conversationID}`,
      { headers: environmentHeaders(appCode, refreshedPassport) },
    )
    expect(deleted.status()).toBe(200)

    await page.screenshot({
      path: path.join(artifactDirectory, 'environment-webapp.png'),
      fullPage: true,
    })
    await writeFile(path.join(artifactDirectory, 'environment-webapp.html'), await page.content())
    await writeFile(
      path.join(artifactDirectory, 'result.json'),
      JSON.stringify(
        {
          url: url.href,
          appCode,
          appID: ownerSite.app_id,
          ownerEndUserID: ownerSite.end_user_id,
          otherEndUserID: otherSite.end_user_id,
          passportLossEndUserStable: true,
          refreshedEndUserStable: true,
          conversationOwnership: ownership,
          staleBuiltInConversationIgnored: true,
          foreignEnvironmentConversationIgnored: true,
          network,
        },
        null,
        2,
      ),
    )
    console.info(`[environment-webapp] passed; artifacts: ${artifactDirectory}`)
  } finally {
    await ownerContext.close()
    await otherContext.close()
    await browser.close()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
