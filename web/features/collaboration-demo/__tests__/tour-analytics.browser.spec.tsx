import type { TenantAccountRole } from '@dify/contracts/api/console/workspaces/types.gen'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { trackEvent } from '@/app/components/base/amplitude'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { TEST_WORKSPACE_ID } from '@/test/console/ids'
import { seedFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import CollaborationDemoPage from '../page'

// boundary: collaboration analytics stop at the telemetry adapter.
vi.mock('@/app/components/base/amplitude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude')>()),
  trackEvent: vi.fn(),
}))

const amplitude = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { ready: true }
  return {
    state,
    setReady(ready: boolean) {
      state.ready = ready
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})

// boundary: the Amplitude SDK loads lazily outside the test page; only its ready signal is supplied.
vi.mock('@/app/components/base/amplitude/init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude/init')>()),
  getIsAmplitudeInitialized: () => amplitude.state.ready,
  subscribeAmplitudeInitialization: amplitude.subscribe,
}))

// boundary: shorten the scripted demo so a natural finish fits a spec; playback stays real.
vi.mock('../playback-script', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../playback-script')>()),
  demoDuration: 0.5,
}))

const workspace = { workspace_id: TEST_WORKSPACE_ID, workspace_plan: 'professional' }

async function renderDemo({
  role = 'owner',
  upgrade = false,
}: { role?: TenantAccountRole; upgrade?: boolean } = {}) {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient)
  seedCurrentWorkspaceQuery(queryClient, { role, plan: 'professional' })
  seedFeatures(
    queryClient,
    upgrade
      ? { workflow_collaboration_upgrade_available: true }
      : { workflow_collaboration_enabled: true },
  )
  const { NavigationProvider } = createTestNavigation({ url: '/collaboration-demo' })
  return render(
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <NuqsTestingAdapter>
          <HotkeysProvider>
            <div style={{ height: 900 }}>
              <CollaborationDemoPage />
            </div>
          </HotkeysProvider>
        </NuqsTestingAdapter>
      </QueryClientTestProvider>
    </NavigationProvider>,
  )
}

const eventsNamed = (name: string) =>
  vi
    .mocked(trackEvent)
    .mock.calls.filter(([event]) => event === name)
    .map(([, properties]) => properties)

async function playToEnd(screen: Awaited<ReturnType<typeof renderDemo>>) {
  await screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }).click()
  await screen.getByRole('button', { name: 'collaborationDemo.steps.comment.action' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toBeVisible()
}

beforeEach(async () => {
  vi.clearAllMocks()
  amplitude.state.ready = true
  await page.viewport(1440, 900)
})

it('counts the guide once it is on screen and a skip with the step it left from', async () => {
  const screen = await renderDemo()
  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.members\.title/ }))
    .toBeVisible()
  await expect
    .poll(() => eventsNamed('collab_tour'))
    .toEqual([{ action: 'tour_shown', ...workspace }])

  await screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }).click()
  const exit = screen.getByRole('button', { name: 'collaborationDemo.exit' }).first()
  await exit.click()
  await exit.click()

  expect(eventsNamed('collab_tour')).toEqual([
    { action: 'tour_shown', ...workspace },
    { action: 'tour_skipped', step: 'comment', ...workspace },
  ])
})

it('waits for Amplitude before counting the guide, and counts no outcome without it', async () => {
  amplitude.state.ready = false
  const screen = await renderDemo()
  await expect
    .element(screen.getByRole('heading', { name: /collaborationDemo\.steps\.members\.title/ }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'collaborationDemo.exit' }).first().click()
  expect(eventsNamed('collab_tour')).toEqual([])

  amplitude.setReady(true)
  await expect
    .poll(() => eventsNamed('collab_tour'))
    .toEqual([{ action: 'tour_shown', ...workspace }])
  await screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }).click()
  await screen.getByRole('button', { name: 'collaborationDemo.exit' }).first().click()
  expect(eventsNamed('collab_tour')).toEqual([
    { action: 'tour_shown', ...workspace },
    { action: 'tour_skipped', step: 'comment', ...workspace },
  ])
})

it('counts a skip during playback and nothing for the replay or close after it', async () => {
  const screen = await renderDemo()
  await screen.getByRole('button', { name: 'collaborationDemo.steps.members.action' }).click()
  await screen.getByRole('button', { name: 'collaborationDemo.steps.comment.action' }).click()
  await screen.getByRole('button', { name: 'collaborationDemo.playback.skip' }).click()

  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()

  expect(eventsNamed('collab_tour')).toEqual([
    { action: 'tour_shown', ...workspace },
    { action: 'tour_skipped', step: 'playback', ...workspace },
  ])
})

it('counts a natural finish once across replays', async () => {
  const screen = await renderDemo()
  await playToEnd(screen)
  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()

  expect(eventsNamed('collab_tour')).toEqual([
    { action: 'tour_shown', ...workspace },
    { action: 'tour_completed', ...workspace },
  ])
})

it('counts the end-page upgrade each time it is shown and when it is clicked', async () => {
  const screen = await renderDemo({ upgrade: true })
  await playToEnd(screen)
  const upgrade = screen.getByRole('button', { name: 'collaborationDemo.end.upgrade.action' })
  await expect.element(upgrade).toBeVisible()

  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  await expect.element(upgrade).toBeVisible()
  await upgrade.click()

  const prompt = { entry_point: 'tour_end', workspace_id: TEST_WORKSPACE_ID }
  expect(eventsNamed('collab_upgrade_prompt')).toEqual([
    { action: 'shown', ...prompt },
    { action: 'shown', ...prompt },
    { action: 'upgrade_clicked', ...prompt },
  ])
})

it('shows no end-page upgrade prompt to members who cannot manage billing', async () => {
  const screen = await renderDemo({ role: 'editor', upgrade: true })
  await playToEnd(screen)

  await expect.element(screen.getByText('collaborationDemo.end.upgrade.contactAdmin')).toBeVisible()
  expect(eventsNamed('collab_upgrade_prompt')).toEqual([])
})
