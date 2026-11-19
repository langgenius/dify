import type { AppDetail } from '@dify/contracts/api/console/apps/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { setAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import CreateAppModal from '../index'

const emojiData = [
  {
    label: 'robot',
    hexcode: '1F916',
    tags: ['face', 'monster'],
    emoji: '🤖',
    text: '',
    type: 1,
    order: 125,
    group: 0,
    subgroup: 11,
    version: 1,
  },
]
const emojiMessages = {
  groups: [{ key: 'smileys-emotion', message: 'smileys & emotion', order: 0 }],
  subgroups: [{ key: 'face-costume', message: 'costumed & creatures', order: 11 }],
  skinTones: [],
}

let appQuota = { size: 0, limit: 1 }
const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), track: vi.fn(), flush: vi.fn() }))
// boundary: observe navigation without a running application router.
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({}),
}))
// boundary: replace the external analytics client; attribution, event construction and awaiting remain real.
vi.mock('@/app/components/base/amplitude/init', () => ({
  getAmplitudeClient: () => ({ track: mocks.track, flush: mocks.flush }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { zGetFeaturesResponse } = await import('@dify/contracts/api/console/features/zod.gen')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': async () => zGetFeaturesResponse.parse({ apps: appQuota }),
      'apps.post': ({ body }: { body: Record<string, unknown> }) => mocks.create(body),
    }),
  }
})

async function renderModal({ quota = { size: 0, limit: 1 }, show = true } = {}) {
  appQuota = quota
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { apps: quota },
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  })
  function Owner({ forcedShow }: { forcedShow?: boolean }) {
    const [open, setOpen] = useState(show)
    const [templates, setTemplates] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open create app</button>
        {templates && <h1>App templates</h1>}
        <CreateAppModal
          show={forcedShow ?? open}
          onClose={() => setOpen(false)}
          onCreateFromTemplate={() => {
            setOpen(false)
            setTemplates(true)
          }}
          defaultAppMode="advanced-chat"
        />
        <AppToaster />
      </>
    )
  }
  const ui = (forcedShow?: boolean) => (
    <Wrapper>
      <NuqsTestingAdapter>
        <Owner forcedShow={forcedShow} />
      </NuqsTestingAdapter>
    </Wrapper>
  )
  const view = await render(ui())
  return { ...view, setShow: (value: boolean) => view.rerender(ui(value)) }
}
const nameInput = () => page.getByRole('textbox', { name: 'app.newApp.name' })
const createButton = () => page.getByRole('button', { name: /app\.newApp\.Create/ })
const dialog = () => page.getByRole('dialog', { name: 'app.newApp.startFromBlank' })
const mod = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
const submitShortcut = () => userEvent.keyboard(`{${mod}>}{Enter}{/${mod}}`)

beforeEach(async () => {
  await page.viewport(1440, 1000)
  mocks.create
    .mockReset()
    .mockResolvedValue(
      createAppDetailFixture({ id: 'created-app', mode: 'advanced-chat', maintainer: 'user-1' }),
    )
  mocks.track.mockReset().mockReturnValue({ promise: Promise.resolve() })
  mocks.flush.mockReset().mockReturnValue({ promise: Promise.resolve() })
  setAnalyticsConsent('granted')
  sessionStorage.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!/^\/.*emoji\/emojibase-17\.0\.0\/en\/(?:data|messages)\.json$/.test(url))
      throw new Error(`Unexpected URL: ${url}`)
    return Response.json(url.endsWith('/messages.json') ? emojiMessages : emojiData)
  })
})
afterEach(() => {
  toast.dismiss()
  setAnalyticsConsent('unknown')
  vi.restoreAllMocks()
})

it('labels the name and description independently and focuses the description from its label', async () => {
  await renderModal()
  await expect.element(page.getByRole('group', { name: 'app.newApp.captionName' })).toBeVisible()
  await expect.element(nameInput()).toBeVisible()
  await page.getByText('app.newApp.captionDescription', { exact: true }).click()
  await expect
    .element(page.getByRole('textbox', { name: 'app.newApp.captionDescription' }))
    .toHaveFocus()
})

it('creates the named app and keeps submission busy until navigation replaces the dialog', async () => {
  await renderModal()
  await nameInput().fill('My App')
  await createButton().click()
  await expect.poll(() => mocks.push.mock.calls).toEqual([['/app/created-app/workflow']])
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    name: 'My App',
    description: '',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    mode: 'advanced-chat',
  })
  await expect.element(dialog()).toBeVisible()
  await expect.element(createButton()).toHaveAttribute('aria-disabled', 'true')
  const bounds = createButton().element().getBoundingClientRect()
  await userEvent.pointer({
    keys: '[MouseLeft]',
    coords: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  })
  expect(mocks.create).toHaveBeenCalledOnce()
})

it('waits for analytics completion before navigating without submitting twice', async () => {
  const tracking = createDeferred<void>()
  mocks.track.mockReturnValue({ promise: tracking.promise })
  await renderModal()
  await nameInput().fill('Tracked App')
  await createButton().click()
  await expect.element(createButton()).toHaveAttribute('aria-disabled', 'true')
  await expect.poll(() => mocks.track.mock.calls.length).toBe(1)
  expect(mocks.push).not.toHaveBeenCalled()
  const bounds = createButton().element().getBoundingClientRect()
  await userEvent.pointer({
    keys: '[MouseLeft]',
    coords: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  })
  expect(mocks.create).toHaveBeenCalledOnce()
  tracking.resolve()
  await expect.poll(() => mocks.push.mock.calls).toEqual([['/app/created-app/workflow']])
})

it('shows the creation error while keeping the dialog available for correction', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Creation failed'))
  await renderModal()
  await nameInput().fill('My App')
  await createButton().click()
  await expect.element(page.getByText('Creation failed', { exact: true })).toBeVisible()
  await expect.element(dialog()).toBeVisible()
  await expect.element(createButton()).not.toHaveAttribute('aria-disabled', 'true')
})

it('shows real quota usage and prevents button or keyboard creation when the workspace is full', async () => {
  await renderModal({ quota: { size: 1, limit: 1 } })
  await expect
    .element(page.getByRole('meter', { name: 'billing.usagePage.buildApps' }))
    .toHaveAttribute('aria-valuenow', '100')
  await expect.element(page.getByText('1/1', { exact: true })).toBeVisible()
  await nameInput().fill('Full workspace')
  await expect.element(createButton()).toBeDisabled()
  await page.getByRole('button', { name: 'app.iconPicker.title' }).click()
  await expect.element(page.getByPlaceholder('app.iconPicker.search')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByPlaceholder('app.iconPicker.search')).not.toBeInTheDocument()
  await nameInput().click()
  await submitShortcut()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('hands the template entry back to its owner and dismisses blank creation', async () => {
  await renderModal()
  await page.getByRole('button', { name: 'app.newApp.noIdeaTip' }).click()
  await expect.element(page.getByRole('heading', { name: 'App templates' })).toBeVisible()
  await expect.element(dialog()).not.toBeInTheDocument()
})

it('creates a beginner chat app with the selected icon color through the scoped native shortcut', async () => {
  mocks.create.mockResolvedValue(
    createAppDetailFixture({ id: 'chat-app', mode: 'chat', maintainer: 'user-1' }),
  )
  await renderModal()
  await page.getByRole('button', { name: 'app.newApp.forBeginners' }).click()
  await page.getByRole('button', { name: /app.types.chatbot/ }).click()
  await nameInput().fill('Keyboard App')
  await page.getByRole('button', { name: 'app.iconPicker.title' }).click()
  await page.getByPlaceholder('app.iconPicker.search').fill('robot')
  await submitShortcut()
  expect(mocks.create).not.toHaveBeenCalled()
  await page.getByRole('radio', { name: 'app.iconPicker.color.green' }).click()
  await page.getByRole('button', { name: /iconPicker\.ok/ }).click()
  await expect.element(page.getByPlaceholder('app.iconPicker.search')).not.toBeInTheDocument()
  await page
    .getByRole('textbox', { name: 'app.newApp.captionDescription' })
    .fill('Created from shortcut')
  await nameInput().click()
  await submitShortcut()
  await expect.poll(() => mocks.push.mock.calls).toEqual([['/app/chat-app/configuration']])
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
    name: 'Keyboard App',
    description: 'Created from shortcut',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F3FEE7',
    mode: 'chat',
  })
})

it('restores keyboard creation after closing and reopening the outer dialog with the icon picker open', async () => {
  const view = await renderModal()
  await page.getByRole('button', { name: 'app.iconPicker.title' }).click()
  // The public show prop can hide the outer dialog while a nested overlay is open.
  await view.setShow(false)
  await expect.element(page.getByPlaceholder('app.iconPicker.search')).not.toBeInTheDocument()
  await view.setShow(true)
  await nameInput().fill('Reopened App')
  await submitShortcut()
  await expect.poll(() => mocks.push.mock.calls).toEqual([['/app/created-app/workflow']])
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: 'Reopened App' }),
  )
})

it('keeps creation unavailable without a name', async () => {
  await renderModal()
  await nameInput().click()
  await submitShortcut()
  await expect.element(createButton()).toBeDisabled()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('submits the final selected app type after switching between advanced and beginner types', async () => {
  await renderModal()
  await page.getByRole('button', { name: /app.types.workflow/ }).click()
  await page.getByRole('button', { name: /app.types.advanced/ }).click()
  await page.getByRole('button', { name: 'app.newApp.forBeginners' }).click()
  await page.getByRole('button', { name: /app.types.agent/ }).click()
  await page.getByRole('button', { name: /app.newApp.completeApp/ }).click()
  await nameInput().fill('Completion App')
  await createButton().click()
  await expect
    .poll(() => mocks.create.mock.calls)
    .toEqual([[expect.objectContaining({ name: 'Completion App', mode: 'completion' })]])
})

it('keeps an in-flight create request single-submission until it succeeds', async () => {
  const pending = createDeferred<AppDetail>()
  mocks.create.mockReturnValueOnce(pending.promise)
  await renderModal()
  await nameInput().fill('Slow App')
  await createButton().click()
  await expect.element(createButton()).toHaveAttribute('aria-disabled', 'true')
  const bounds = createButton().element().getBoundingClientRect()
  await userEvent.pointer({
    keys: '[MouseLeft]',
    coords: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  })
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.push).not.toHaveBeenCalled()
  pending.resolve(
    createAppDetailFixture({ id: 'slow-app', mode: 'advanced-chat', maintainer: 'user-1' }),
  )
  await expect.poll(() => mocks.push.mock.calls).toEqual([['/app/slow-app/workflow']])
})
