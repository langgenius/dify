import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNetworkAccessGroupFixture } from '@/test/console/network-access'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { PolicyItem } from '../policy-item'

vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

async function renderPolicy(canMutate = true) {
  const group = createNetworkAccessGroupFixture()
  const onView = vi.fn()
  const onEdit = vi.fn()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  const screen = await render(
    <ConsoleProvider>
      <button type="button">Before policy</button>
      <section aria-label="IP policy row" style={{ width: 800 }}>
        <PolicyItem group={group} canMutate={canMutate} onView={onView} onEdit={onEdit} />
      </section>
    </ConsoleProvider>,
  )
  return { screen, group, onView, onEdit }
}

// Real hit testing catches the row padding that unit clicks on the name button do not reach.
it.each([true, false])(
  'opens the policy from padding on every side of the row (can manage: %s)',
  async (canMutate) => {
    const { screen, group, onView, onEdit } = await renderPolicy(canMutate)
    const row = screen.getByRole('region', { name: 'IP policy row' })
    const { width, height } = row.element().getBoundingClientRect()
    const positions = [
      { x: width / 2, y: 2 },
      { x: width / 2, y: height - 2 },
      { x: 2, y: height / 2 },
      { x: width - 2, y: height / 2 },
    ]
    if (!canMutate) positions.push({ x: width - 20, y: height / 2 })

    for (const [index, position] of positions.entries()) {
      await row.click({ position })
      expect(onView).toHaveBeenCalledTimes(index + 1)
      expect(onView).toHaveBeenLastCalledWith(group)
    }
    expect(onEdit).not.toHaveBeenCalled()
  },
)

it('keeps the row and its separate actions reachable with pointer and keyboard', async () => {
  const { screen, group, onView, onEdit } = await renderPolicy()
  const policy = screen.getByRole('button', { name: group.name })
  const more = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })

  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(group)
  expect(onView).not.toHaveBeenCalled()

  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const confirmation = screen.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  expect(onView).not.toHaveBeenCalled()
  await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'Before policy' }).click()
  await userEvent.tab()
  await expect.element(policy).toHaveFocus()
  expect(policy.element().matches(':focus-visible')).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(onView).toHaveBeenCalledExactlyOnceWith(group)
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('menu')).toBeVisible()
  expect(onView).toHaveBeenCalledTimes(1)
})
