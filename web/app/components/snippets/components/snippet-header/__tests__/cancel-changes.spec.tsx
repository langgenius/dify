import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CancelChanges from '../cancel-changes'

describe('CancelChanges', () => {
  it('should render editing state without discard action when changes cannot be discarded', () => {
    render(<CancelChanges canDiscardChanges={false} onCancel={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'snippet.discardDraft' })).not.toBeInTheDocument()
    expect(screen.getByText('snippet.editingDraft')).toBeInTheDocument()
  })

  it('should confirm before discarding draft changes', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn().mockResolvedValue(undefined)

    render(<CancelChanges canDiscardChanges onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'snippet.discardDraft' }))

    expect(screen.getByText('snippet.discardChangesTitle')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'snippet.discardChanges' }))

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
