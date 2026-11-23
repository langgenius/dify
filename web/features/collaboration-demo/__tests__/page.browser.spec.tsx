import type { GetAppsData } from '@dify/contracts/api/console/apps/types.gen'
import type { TenantAccountRole } from '@dify/contracts/api/console/workspaces/types.gen'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import CollaborationDemoPage from '../page'

const api = vi.hoisted(() => ({
  apps: vi.fn<(input: Pick<GetAppsData, 'query'>) => unknown>(),
  replace: vi.fn(),
}))

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace: api.replace }) }))

// boundary: only generated service responses are replaced; queries and overlays stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'apps.get': api.apps }),
  }
})

const appPage = (app?: { id: string; name: string; updated_at: number }) => ({
  data: app ? [{ ...app, mode: 'workflow' as const, icon_url: null }] : [],
  has_more: false,
  limit: 1,
  page: 1,
  total: app ? 1 : 0,
})

async function renderDemo(role: TenantAccountRole) {
  await page.viewport(1440, 900)
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  seedCurrentWorkspaceQuery(queryClient, { role })
  seedFeatures(queryClient, { workflow_collaboration_enabled: true })
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <HotkeysProvider>
          <div style={{ height: 900 }}>
            <CollaborationDemoPage />
          </div>
        </HotkeysProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.apps.mockImplementation(async (input) =>
    input.query?.mode === 'workflow'
      ? appPage({ id: 'workflow-1', name: 'Older workflow', updated_at: 10 })
      : appPage({ id: 'chatflow-1', name: 'Refund assistant', updated_at: 20 }),
  )
})

async function startPlayback(screen: Awaited<ReturnType<typeof renderDemo>>) {
  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.members\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.comment\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
}

it('walks the guide, playback and end panel from the keyboard', async () => {
  const screen = await renderDemo('editor')

  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.members\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.comment\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}{Tab}')
  const commentTool = screen.getByRole('button', { name: 'collaborationDemo.commentTool' })
  await expect.element(commentTool).toHaveFocus()
  await expect.element(commentTool).toHaveAttribute('aria-pressed', 'false')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
  await expect.element(commentTool).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.resume' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await userEvent.keyboard('{Enter}')

  const endPanel = screen.getByRole('region', { name: 'collaborationDemo.end.enabled.title' })
  await expect
    .element(endPanel.getByRole('heading', { name: 'collaborationDemo.end.enabled.title' }))
    .toHaveFocus()
  await expect
    .element(endPanel.getByText(/collaborationDemo\.end\.enabled\.latestApp/))
    .toMatchTextContent(/Refund assistant/)
  await expect
    .element(endPanel.getByRole('link', { name: 'collaborationDemo.end.enabled.action' }))
    .toHaveAttribute('href', '/app/chatflow-1/workflow')

  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('link', { name: 'collaborationDemo.end.enabled.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('button', { name: 'collaborationDemo.end.close' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(api.replace).toHaveBeenCalledWith('/apps')

  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
})

it('explains read-only access without looking up apps', async () => {
  const screen = await renderDemo('normal')

  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.members\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.comment\.title/ }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}{Enter}')

  const endPanel = screen.getByRole('region', { name: 'collaborationDemo.end.enabled.title' })
  await expect.element(endPanel.getByText('collaborationDemo.end.readOnly.normal')).toBeVisible()
  await expect.element(endPanel.getByRole('link')).not.toBeInTheDocument()
  expect(api.apps).not.toHaveBeenCalled()
})

it('announces messages through a region that exists before the first message', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)

  const log = screen.getByRole('log')
  await expect.element(log).toHaveAttribute('aria-live', 'polite')
  await expect.element(log).toBeEmptyDOMElement()
  await userEvent.keyboard('{Escape}')
  await expect.element(log).toHaveAttribute('aria-live', 'off')
  await userEvent.keyboard('{Tab}{Enter}')
  await expect.element(log).toMatchTextContent(/"author":"Sam".*"author":"Alex"/)
})

it('keeps focus on the primary action when Try it now becomes ready', async () => {
  const apps = createDeferred<ReturnType<typeof appPage>>()
  api.apps.mockReturnValue(apps.promise)
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  await userEvent.keyboard('{Tab}{Enter}')

  const endPanel = screen.getByRole('region', { name: 'collaborationDemo.end.enabled.title' })
  await expect.element(endPanel.getByRole('heading')).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('button', { name: 'collaborationDemo.end.enabled.action' }))
    .toHaveFocus()
  apps.resolve(appPage({ id: 'chatflow-1', name: 'Refund assistant', updated_at: 20 }))
  await expect
    .element(endPanel.getByRole('link', { name: 'collaborationDemo.end.enabled.action' }))
    .toHaveFocus()
})

it('makes the comment marker reopen the thread once playback has finished', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  await userEvent.keyboard('{Tab}{Enter}')

  await expect
    .element(screen.getByRole('heading', { name: 'collaborationDemo.end.enabled.title' }))
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.thread.close' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const marker = screen.getByRole('button', { name: /collaborationDemo\.thread\.open/ })
  await expect.element(marker).toHaveFocus()
  await expect.element(marker).toHaveAccessibleName(/"count":2/)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.thread.close' }))
    .toHaveFocus()
})

it('opens the thread beside its marker and closes it for a replay', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  await userEvent.keyboard('{Tab}{Enter}')

  const thread = screen.getByRole('dialog', { name: 'workflowComments.comments.panelTitle' })
  await expect.poll(() => getComputedStyle(thread.element()).opacity).toBe('1')
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}')
  const marker = screen.getByRole('button', { name: /collaborationDemo\.thread\.open/ })
  await expect.element(marker).toHaveFocus()
  const markerBox = marker.element().getBoundingClientRect()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => getComputedStyle(thread.element()).opacity).toBe('1')
  const threadBox = thread.element().getBoundingClientRect()
  expect(threadBox.left - markerBox.right).toBeCloseTo(17, 0)
  expect(document.querySelector('.react-flow')!.scrollTop).toBe(0)

  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  await expect.element(thread).not.toBeInTheDocument()
})

it('pauses when the thread is closed during playback and brings it back on resume', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)

  const close = screen.getByRole('button', { name: 'collaborationDemo.thread.close' })
  await expect.element(close).toBeInTheDocument()
  await close.click()

  const marker = screen.getByRole('button', { name: /collaborationDemo\.thread\.open/ })
  await expect.element(marker).toHaveFocus()
  await expect.element(marker).toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.resume' }))
    .toBeVisible()

  await userEvent.keyboard('{Enter}')
  await expect.element(close).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(marker).toHaveFocus()

  await screen.getByRole('button', { name: 'collaborationDemo.playback.resume' }).click()
  await expect.element(close).toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toBeVisible()
})

it('keeps the thread open when playback controls are pressed while paused', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  const close = screen.getByRole('button', { name: 'collaborationDemo.thread.close' })
  await expect.element(close).toBeInTheDocument()

  await userEvent.keyboard('{Escape}')
  await screen.getByRole('button', { name: 'collaborationDemo.playback.skip' }).click()

  await expect
    .element(screen.getByRole('heading', { name: 'collaborationDemo.end.enabled.title' }))
    .toHaveFocus()
  await expect.element(close).toBeInTheDocument()
})
