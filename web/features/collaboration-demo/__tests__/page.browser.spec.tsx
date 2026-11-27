import type { TenantAccountRole } from '@dify/contracts/api/console/workspaces/types.gen'
import type { TestNavigation } from '@/test/next-navigation'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import CollaborationDemoPage from '../page'

let navigation: TestNavigation

async function renderDemo(
  role: TenantAccountRole,
  searchParams = '',
  direction: 'ltr' | 'rtl' = 'ltr',
) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  seedCurrentWorkspaceQuery(queryClient, { role })
  seedFeatures(queryClient, { workflow_collaboration_enabled: true })
  navigation = createTestNavigation({ url: `/collaboration-demo?${searchParams}` })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <NuqsTestingAdapter searchParams={searchParams}>
          <HotkeysProvider>
            <DirectionProvider direction={direction}>
              <div dir={direction} style={{ height: 900 }}>
                <CollaborationDemoPage />
              </div>
            </DirectionProvider>
          </HotkeysProvider>
        </NuqsTestingAdapter>
      </QueryClientTestProvider>
    </NavigationProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await page.viewport(1440, 900)
})

async function startPlayback(screen: Awaited<ReturnType<typeof renderDemo>>) {
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.comment.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
}

it('walks the guide, playback and end panel from the keyboard', async () => {
  const screen = await renderDemo('editor')

  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.comment.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
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
  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('link', { name: 'collaborationDemo.end.goToStudio' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('button', { name: 'collaborationDemo.end.close' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(navigation.router.replace).toHaveBeenCalledWith('/apps')

  await userEvent.keyboard('{Tab}')
  await expect
    .element(endPanel.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }))
    .toHaveFocus()
})

it('offers an enabled workspace member the Studio entry without choosing an app', async () => {
  const screen = await renderDemo('normal')
  await startPlayback(screen)
  await userEvent.keyboard('{Tab}{Enter}')

  const endPanel = screen.getByRole('region', { name: 'collaborationDemo.end.enabled.title' })
  const studioLink = endPanel.getByRole('link', { name: 'collaborationDemo.end.goToStudio' })
  await expect.element(studioLink).toHaveAttribute('href', '/apps')
  await userEvent.keyboard('{Tab}')
  await expect.element(studioLink).toHaveFocus()
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

it('zooms the canvas with the comment pinned to it and frames it again for a replay', async () => {
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  await userEvent.keyboard('{Tab}{Enter}')
  const marker = screen.getByRole('button', { name: /collaborationDemo\.thread\.open/ })
  await expect.element(marker).toBeVisible()
  const framed = marker.element().getBoundingClientRect()

  document
    .querySelector('.react-flow__pane')!
    .dispatchEvent(
      new WheelEvent('wheel', { deltaY: -400, clientX: 400, clientY: 400, bubbles: true }),
    )
  await expect.poll(() => marker.element().getBoundingClientRect().left).not.toBe(framed.left)

  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  await screen.getByRole('button', { name: 'collaborationDemo.playback.skip' }).click()
  await expect.poll(() => marker.element().getBoundingClientRect().left).toBeCloseTo(framed.left, 0)
  expect(marker.element().getBoundingClientRect().top).toBeCloseTo(framed.top, 0)
})

it("shows the editor's Toolbar with only the comment tool reachable", async () => {
  const screen = await renderDemo('owner')
  await expect
    .element(screen.getByRole('button', { name: 'workflow.common.handMode', includeHidden: true }))
    .toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'workflow.common.handMode' }).query()).toBeNull()

  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const commentTool = screen.getByRole('button', { name: 'collaborationDemo.commentTool' })
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.steps.comment.action' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(commentTool).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(commentTool).not.toHaveFocus()
  expect(document.activeElement?.closest('[inert]')).toBeNull()
})

it('closes a demo tab opened from the product and goes to Studio otherwise', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const screen = await renderDemo('owner')
  const exit = screen.getByRole('button', { name: 'collaborationDemo.exit' }).first()

  await exit.click()
  expect(close).not.toHaveBeenCalled()
  expect(navigation.router.replace).toHaveBeenCalledWith('/apps')

  vi.spyOn(window, 'opener', 'get').mockReturnValue(window)
  await exit.click()
  await expect.poll(() => close).toHaveBeenCalledOnce()
})

it('closes a demo tab opened from the in-site notification', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const screen = await renderDemo('owner', '?source=notification')

  await screen.getByRole('button', { name: 'collaborationDemo.exit' }).first().click()
  await expect.poll(() => close).toHaveBeenCalledOnce()
})

it('lays out playback and the thread in the page direction, which React Flow resets', async () => {
  document.documentElement.dir = 'rtl'
  onTestFinished(() => document.documentElement.removeAttribute('dir'))
  const screen = await renderDemo('owner', '', 'rtl')
  await startPlayback(screen)
  const pause = screen.getByRole('button', { name: 'collaborationDemo.playback.pause' })
  expect(getComputedStyle(pause.element()).direction).toBe('rtl')

  await userEvent.keyboard('{Tab}{Enter}')
  const thread = screen.getByRole('dialog', { name: 'workflowComments.comments.panelTitle' })
  await expect.element(thread).toBeVisible()
  expect(getComputedStyle(thread.element()).direction).toBe('rtl')
})

it("keeps the playback controls above the preview's zoom control on a narrow canvas", async () => {
  // Measure and focus the guide at the viewport this test uses, before keyboard input.
  await page.viewport(375, 900)
  const screen = await renderDemo('owner')
  await startPlayback(screen)
  const pause = screen.getByRole('button', { name: 'collaborationDemo.playback.pause' }).element()
  const box = pause.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2)
  expect(pause.contains(hit)).toBe(true)
})
