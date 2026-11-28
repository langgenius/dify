import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReindexConfirmDialog } from '../reindex-confirm-dialog'
import { useReindexConfirmation } from '../use-reindex-confirmation'

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

  it('says what a reindex of several documents covers and words its button for them', () => {
    render(
      <ReindexConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="Reindex all"
        scope="3 documents selected"
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('3 documents selected')
    expect(screen.getByRole('button', { name: 'Reindex all' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'knowledgeDocuments.reindexDocument' }),
    ).not.toBeInTheDocument()
  })
})

describe('useReindexConfirmation', () => {
  it('drops the request when the reindex stops being available and does not bring it back', () => {
    const { result, rerender } = renderHook(
      ({ available }: { available: boolean }) => useReindexConfirmation(available),
      { initialProps: { available: true } },
    )
    expect(result.current.open).toBe(false)
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(true)

    rerender({ available: false })
    expect(result.current.open).toBe(false)
    rerender({ available: true })
    expect(result.current.open).toBe(false)
  })

  it('does not open for a reindex that cannot be started', () => {
    const { result } = renderHook(() => useReindexConfirmation(false))
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(false)
  })
})
