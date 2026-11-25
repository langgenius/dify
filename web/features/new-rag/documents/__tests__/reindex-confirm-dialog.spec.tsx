import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReindexConfirmDialog } from '../reindex-confirm-dialog'

describe('ReindexConfirmDialog', () => {
  it('warns that the source file overwrites chunk edits and reindexes only once confirmed', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<ReindexConfirmDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('knowledgeDocuments.reindexConfirmTitle')
    expect(dialog).toHaveTextContent('knowledgeDocuments.reindexConfirmDescription')

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything())
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'knowledgeDocuments.reindexDocument' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('stays out of the page until a reindex is requested', () => {
    render(<ReindexConfirmDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
