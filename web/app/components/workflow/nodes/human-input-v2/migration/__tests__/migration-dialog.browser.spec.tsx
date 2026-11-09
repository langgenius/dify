import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import HumanInputMigrationDialog from '../migration-dialog'

function DialogOwner() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [requests, setRequests] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open migration
      </button>
      <a href="#outside">Outside</a>
      <output aria-label="Migration requests">{requests}</output>
      <HumanInputMigrationDialog
        open={open}
        pending={pending}
        nodeCount={3}
        onOpenChange={setOpen}
        onConfirm={() => {
          setRequests((n) => n + 1)
          setPending(true)
        }}
      />
    </>
  )
}
const trigger = () => page.getByRole('button', { name: 'Open migration' })
const dialog = () => page.getByRole('alertdialog')
const cancel = () => page.getByRole('button', { name: 'common.operation.cancel' })
const confirm = () =>
  page.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrate' })

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1000, 700)
})

it('presents the migration copy and returns to its caller after Cancel', async () => {
  await render(<DialogOwner />)
  await trigger().click()
  await expect
    .element(
      page.getByRole('alertdialog', {
        name: 'workflow.nodes.humanInputMigration.dialog.title:{"count":3}',
      }),
    )
    .toBeVisible()
  await expect
    .element(dialog())
    .toHaveAccessibleDescription(
      /workflow.nodes.humanInputMigration.dialog.description.*workflow.nodes.humanInputMigration.dialog.review.*workflow.nodes.humanInputMigration.dialog.draftNotice/,
    )
  await cancel().click()
  await expect.element(dialog()).not.toBeInTheDocument()
  await expect.element(trigger()).toHaveFocus()
})

it('keeps the pending confirmation open and accepts only one request', async () => {
  await render(<DialogOwner />)
  await trigger().click()
  await confirm().click()
  await expect.element(confirm()).toHaveAttribute('aria-disabled', 'true')
  await expect.element(cancel()).toHaveAttribute('aria-disabled', 'true')
  // The pending actions remain keyboard reachable; activation must not dismiss or resubmit.
  await expect.element(confirm()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await userEvent.tab({ shift: true })
  await expect.element(cancel()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog()).toBeVisible()
  await expect.element(page.getByLabelText('Migration requests')).toHaveTextContent('1')
})

it('presents the recoverable error within the migration confirmation', async () => {
  await render(
    <HumanInputMigrationDialog
      open
      pending={false}
      nodeCount={1}
      error="Approval could not be migrated"
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  )
  await expect
    .element(dialog().getByRole('alert'))
    .toHaveTextContent('Approval could not be migrated')
})
