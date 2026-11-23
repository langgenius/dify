import type { DemoEndState } from '../../end-state'
import type { TestNavigation } from '@/test/next-navigation'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { createTestNavigation } from '@/test/next-navigation'
import { DemoEndPanel } from '../demo-end-panel'

const api = { urlUpdate: vi.fn() }
let navigation: TestNavigation

const app = { id: 'chatflow-1', name: 'Refund assistant', updated_at: 20 }

async function renderPanel(state: DemoEndState) {
  const onReplay = vi.fn()
  const onExit = vi.fn()
  navigation = createTestNavigation({ url: '/collaboration-demo' })
  const { NavigationProvider } = navigation
  const panel = (current: DemoEndState) => (
    <NavigationProvider>
      <NuqsTestingAdapter onUrlUpdate={api.urlUpdate}>
        <DemoEndPanel state={current} onReplay={onReplay} onExit={onExit} />
      </NuqsTestingAdapter>
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

it.each<[DemoEndState, string, string]>([
  [{ kind: 'tryNow', app }, 'collaborationDemo.end.enabled.action', '/app/chatflow-1/workflow'],
  [{ kind: 'appsError' }, 'collaborationDemo.end.goToStudio', '/apps'],
  [
    { kind: 'createApp' },
    'collaborationDemo.end.createWorkflow',
    '/apps?create=blank&mode=workflow',
  ],
])('links %o to its destination', async (state, name, href) => {
  const { screen } = await renderPanel(state)

  await expect
    .element(screen.getByRole('heading', { name: 'collaborationDemo.end.enabled.title' }))
    .toHaveFocus()
  await expect.element(screen.getByRole('link', { name })).toHaveAttribute('href', href)
  await expect
    .element(screen.getByRole('button', { name: 'collaborationDemo.end.close' }))
    .toBeVisible()
})

it.each<[DemoEndState, string]>([
  [{ kind: 'readOnly', role: 'normal' }, 'collaborationDemo.end.readOnly.normal'],
  [{ kind: 'readOnly', role: 'datasetOperator' }, 'collaborationDemo.end.readOnly.datasetOperator'],
  [{ kind: 'upgradeContactAdmin' }, 'collaborationDemo.end.upgrade.contactAdmin'],
])('offers only close and replay for %o', async (state, description) => {
  const { screen, onReplay } = await renderPanel(state)

  await expect.element(screen.getByText(description)).toBeVisible()
  expect(screen.getByRole('link').elements()).toHaveLength(0)
  expect(screen.getByRole('button').elements()).toHaveLength(2)
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
  const { screen, onExit } = await renderPanel({ kind: 'createApp' })

  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()
  expect(onExit).toHaveBeenCalledOnce()
})

it('keeps focus in the panel when a focused loading action resolves to none', async () => {
  const { screen, rerender } = await renderPanel({ kind: 'loading' })
  const close = screen.getByRole('button', { name: 'collaborationDemo.end.close' })
  await expect.element(close).toBeVisible()

  screen.getByRole('button', { name: 'collaborationDemo.end.enabled.action' }).element().focus()
  await rerender({ kind: 'readOnly', role: 'normal' })
  await expect.element(close).toHaveFocus()
})
