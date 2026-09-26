import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../__tests__/workflow-test-env'
import { CommentPlacementPreview } from './placement-preview'

vi.mock('next/navigation', () => ({ useParams: () => ({ appId: 'app-1' }) }))

function renderPlacement(placing = true) {
  const onCancel = vi.fn()
  const result = renderWorkflowComponent(
    <HotkeysProvider>
      <button>Canvas action</button>
      <button onKeyDown={(event) => event.preventDefault()}>Local escape owner</button>
      <input aria-label="Node input" />
      <CommentPlacementPreview onSubmit={vi.fn()} onCancel={onCancel} />
    </HotkeysProvider>,
    { initialStoreState: { isCommentPlacing: placing, mentionableUsersCache: { 'app-1': [] } } },
  )
  return { ...result, onCancel }
}

it('cancels pending placement from the canvas without focusing the disabled preview', async () => {
  const user = userEvent.setup()
  const { onCancel } = renderPlacement()
  await user.click(screen.getByRole('button', { name: 'Canvas action' }))
  const owner = screen.getByRole('button', { name: 'Canvas action' })
  for (const repeat of [false, true, true]) {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      repeat,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(owner, event)
    expect(event.defaultPrevented).toBe(true)
  }
  fireEvent.keyUp(owner, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
})

it('leaves claimed, composing, and input Escape with their local owner', async () => {
  const user = userEvent.setup()
  const { onCancel } = renderPlacement()
  await user.click(screen.getByRole('button', { name: 'Local escape owner' }))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('textbox', { name: 'Node input' }))
  await user.keyboard('{Escape}')
  const canvasAction = screen.getByRole('button', { name: 'Canvas action' })
  fireEvent.keyDown(canvasAction, { key: 'Escape', isComposing: true })
  fireEvent.keyUp(canvasAction, { key: 'Escape' })
  expect(onCancel).not.toHaveBeenCalled()
})

it('stops owning Escape when inactive or once the editable draft is placed', async () => {
  const user = userEvent.setup()
  const { store, onCancel } = renderPlacement(false)
  await user.click(screen.getByRole('button', { name: 'Canvas action' }))
  await user.keyboard('{Escape}')
  act(() =>
    store.setState({
      isCommentPlacing: true,
      pendingComment: { pageX: 0, pageY: 0, elementX: 0, elementY: 0 },
    }),
  )
  await user.keyboard('{Escape}')
  expect(onCancel).not.toHaveBeenCalled()
})
