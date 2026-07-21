import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HumanInputMigrationDialog from '../migration-dialog'

const DialogHarness = ({ onConfirm = vi.fn() }: { onConfirm?: () => void }) => {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open migration
      </button>
      <a href="#outside">outside</a>
      <HumanInputMigrationDialog
        open={open}
        pending={pending}
        onOpenChange={setOpen}
        onConfirm={() => {
          onConfirm()
          setPending(true)
        }}
      />
    </>
  )
}

describe('Human Input migration dialog', () => {
  it('renders accessible confirmation copy, traps focus, cancels, and restores focus', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: 'open migration' })
    await user.click(trigger)

    expect(
      screen.getByRole('alertdialog', {
        name: 'workflow.nodes.humanInputMigration.dialog.title',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.humanInputMigration.dialog.description'),
    ).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInputMigration.dialog.review')).toBeInTheDocument()
    expect(screen.getByText('outside')).not.toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape and restores focus to the invoking control', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: 'open migration' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('locks both actions and prevents duplicate confirmation while pending', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<DialogHarness onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'open migration' }))
    const confirm = screen.getByRole('button', {
      name: 'workflow.nodes.humanInputMigration.action.migrate',
    })
    await user.dblClick(confirm)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: /workflow.nodes.humanInputMigration.action.migrating/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('presents a node-specific recoverable error', () => {
    render(
      <HumanInputMigrationDialog
        open
        pending={false}
        error="Approval could not be migrated"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Approval could not be migrated')
  })
})
