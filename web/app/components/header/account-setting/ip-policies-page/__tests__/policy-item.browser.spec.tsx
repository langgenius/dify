import type { PolicyDialogPayload } from '../policy-dialog-payload'
import {
  createDialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNetworkAccessGroupFixture } from '@/test/console/network-access'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { PolicyItem } from '../policy-item'

async function renderPolicy(canMutate = true) {
  onTestFinished(guardUnexpectedFetch())
  const group = createNetworkAccessGroupFixture()
  const policyDialog = createDialogHandle<PolicyDialogPayload>()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  const screen = await render(
    <ConsoleProvider>
      <button type="button">Before policy</button>
      <section aria-label="IP policy row" style={{ width: 800 }}>
        <div role="table" aria-label="IP policies">
          <PolicyItem
            group={group}
            canMutate={canMutate}
            policyDialog={policyDialog}
            onFormOpen={() => {}}
          />
        </div>
      </section>
      <Dialog handle={policyDialog}>
        {({ payload }) => (
          <DialogContent>
            <DialogTitle>{payload?.opener ? 'Edit from menu' : 'Open from row'}</DialogTitle>
            <DialogClose>Close</DialogClose>
          </DialogContent>
        )}
      </Dialog>
    </ConsoleProvider>,
  )
  return { screen, group }
}

// Real hit testing catches the row padding that unit clicks on the name button do not reach.
it.each([true, false])(
  'opens the policy from padding on every side of the row (can manage: %s)',
  async (canMutate) => {
    const { screen } = await renderPolicy(canMutate)
    const row = screen.getByRole('region', { name: 'IP policy row' })
    const { width, height } = row.element().getBoundingClientRect()
    const positions = [
      { x: width / 2, y: 2 },
      { x: width / 2, y: height - 2 },
      { x: 2, y: height / 2 },
      { x: width - 2, y: height / 2 },
    ]
    if (!canMutate) positions.push({ x: width - 20, y: height / 2 })

    const editor = screen.getByRole('dialog', { name: 'Open from row' })
    for (const position of positions) {
      await row.click({ position })
      await expect.element(editor).toBeVisible()
      await editor.getByRole('button', { name: 'Close' }).click()
      await expect.element(editor).not.toBeInTheDocument()
    }
  },
)

it('keeps the row and its separate actions reachable with pointer and keyboard', async () => {
  const { screen, group } = await renderPolicy()
  const policy = screen.getByRole('button', { name: group.name })
  const more = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })

  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  const menuEditor = screen.getByRole('dialog', { name: 'Edit from menu' })
  await expect.element(menuEditor).toBeVisible()
  await menuEditor.getByRole('button', { name: 'Close' }).click()
  await expect.element(menuEditor).not.toBeInTheDocument()

  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.delete' }).click()
  const confirmation = screen.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'Before policy' }).click()
  await userEvent.tab()
  await expect.element(policy).toHaveFocus()
  expect(policy.element().matches(':focus-visible')).toBe(true)
  await userEvent.keyboard('{Enter}')
  const rowEditor = screen.getByRole('dialog', { name: 'Open from row' })
  await expect.element(rowEditor).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(rowEditor).not.toBeInTheDocument()
  await expect.element(policy).toHaveFocus()
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('menu')).toBeVisible()
  await expect.element(rowEditor).not.toBeInTheDocument()
})
