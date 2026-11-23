import type { DemoEndState } from '../../end-state'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { DemoEndPanel } from '../demo-end-panel'

const api = vi.hoisted(() => ({ replace: vi.fn(), urlUpdate: vi.fn() }))

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace: api.replace }) }))

const app = { id: 'chatflow-1', name: 'Refund assistant', updated_at: 20 }

async function renderPanel(state: DemoEndState) {
  const onReplay = vi.fn()
  const screen = await render(
    <NuqsTestingAdapter onUrlUpdate={api.urlUpdate}>
      <DemoEndPanel state={state} onReplay={onReplay} />
    </NuqsTestingAdapter>,
  )
  return { screen, onReplay }
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
  expect(api.replace).toHaveBeenCalledWith('/apps')
})

it('closes a demo tab opened from the product and falls back to the apps list otherwise', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const { screen } = await renderPanel({ kind: 'createApp' })

  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()
  expect(close).not.toHaveBeenCalled()
  expect(api.replace).toHaveBeenCalledWith('/apps')

  vi.spyOn(window, 'opener', 'get').mockReturnValue(window)
  api.replace.mockClear()
  await screen.getByRole('button', { name: 'collaborationDemo.end.close' }).click()
  expect(close).toHaveBeenCalledOnce()
})
