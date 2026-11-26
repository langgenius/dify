import type { DemoEndState } from '../../end-state'
import type { TestNavigation } from '@/test/next-navigation'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import { DemoEndPanel } from '../demo-end-panel'

const api = { urlUpdate: vi.fn() }
let navigation: TestNavigation

async function renderPanel(state: DemoEndState) {
  const onReplay = vi.fn()
  const onExit = vi.fn()
  const queryClient = createTestQueryClient()
  seedCurrentWorkspaceQuery(queryClient)
  navigation = createTestNavigation({ url: '/collaboration-demo' })
  const { NavigationProvider } = navigation
  const panel = (current: DemoEndState) => (
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <NuqsTestingAdapter onUrlUpdate={api.urlUpdate}>
          <DemoEndPanel state={current} onReplay={onReplay} onExit={onExit} />
        </NuqsTestingAdapter>
      </QueryClientTestProvider>
    </NavigationProvider>
  )
  const screen = await render(panel(state))
  return {
    screen,
    onReplay,
    onExit,
    rerender: (next: DemoEndState) => screen.rerender(panel(next)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('explains who can upgrade and offers close and replay to other members', async () => {
  const { screen, onReplay } = await renderPanel({ kind: 'upgradeContactAdmin' })

  await expect.element(screen.getByText('collaborationDemo.end.upgrade.contactAdmin')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.end.upgrade.action' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.end.close' }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }).click()
  expect(onReplay).toHaveBeenCalledOnce()
})

it('opens the pricing modal for admins without collaboration', async () => {
  const { screen } = await renderPanel({ kind: 'upgrade' })

  await expect
    .element(screen.getByRole('heading', { name: 'collaborationDemo.end.upgrade.title' }))
    .toHaveFocus()
  await screen.getByRole('button', { name: 'collaborationDemo.end.upgrade.action' }).click()
  expect(api.urlUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ queryString: expect.stringContaining('open') }),
  )
})

it('sends users back to the workspace when collaboration is unavailable', async () => {
  const { screen } = await renderPanel({ kind: 'unavailable' })

  await expect
    .element(screen.getByRole('heading', { name: 'collaborationDemo.end.unavailable.title' }))
    .toHaveFocus()
  expect(
    screen.getByRole('button', { name: 'collaborationDemo.end.close' }).elements(),
  ).toHaveLength(0)
  await screen.getByRole('button', { name: 'collaborationDemo.end.backToWorkspace' }).click()
  expect(navigation.router.replace).toHaveBeenCalledWith('/apps')
})

it('leaves the demo through Close', async () => {
  const { screen, onExit } = await renderPanel({ kind: 'enabled' })

  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()
  expect(onExit).toHaveBeenCalledOnce()
})

it('keeps Close focused as the Studio link becomes available', async () => {
  const { screen, rerender } = await renderPanel({ kind: 'loading' })
  const close = screen.getByRole('button', { name: 'collaborationDemo.end.close' })
  const studioLink = screen.getByRole('link', { name: 'collaborationDemo.end.goToStudio' })

  await expect.element(screen.getByText('collaborationDemo.end.loading')).toBeVisible()
  await expect.element(studioLink).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.playback.replay' }))
    .toBeVisible()
  close.element().focus()

  await rerender({ kind: 'enabled' })
  await expect.element(studioLink).toHaveAttribute('href', '/apps')
  await expect.element(close).toHaveFocus()
})
