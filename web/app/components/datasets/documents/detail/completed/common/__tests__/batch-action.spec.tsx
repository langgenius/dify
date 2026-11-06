import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import BatchAction from '../batch-action'

describe('BatchAction', () => {
  it.each([
    ['onBatchEnable', 'dataset.batchAction.enable'],
    ['onBatchDisable', 'dataset.batchAction.disable'],
    ['onBatchDownload', 'dataset.batchAction.download'],
    ['onArchive', 'dataset.batchAction.archive'],
    ['onEditMetadata', 'dataset.metadata.metadata'],
    ['onBatchReIndex', 'dataset.batchAction.reIndex'],
  ] as const)('dispatches %s for the selected documents', async (callback, name) => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <BatchAction
        selectedIds={['doc-1', 'doc-2']}
        onCancel={vi.fn()}
        {...{ [callback]: onAction }}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('disables mutations while keeping cancellation available', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    render(
      <BatchAction
        selectedIds={['doc-1']}
        disabled
        onBatchEnable={onAction}
        onBatchDisable={onAction}
        onBatchDelete={onDelete}
        onCancel={onCancel}
      />,
    )

    for (const action of ['enable', 'disable', 'delete']) {
      const button = screen.getByRole('button', { name: `dataset.batchAction.${action}` })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(onAction).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('requires confirmation and keeps the dialog open until deletion finishes', async () => {
    const user = userEvent.setup()
    let resolveDelete!: () => void
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
    )
    render(<BatchAction selectedIds={['doc-1']} onBatchDelete={onDelete} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
    let dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'dataset.batchAction.delete' }))
    dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'common.operation.sure' })
    await user.click(confirm)
    expect(onDelete).toHaveBeenCalledOnce()
    expect(dialog).toBeInTheDocument()
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    await act(async () => resolveDelete())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
