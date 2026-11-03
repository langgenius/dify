import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import UndoRedo from '../undo-redo'

// The separate workflow-version picker does not own local undo/redo availability.
vi.mock('@/app/components/workflow/header/view-workflow-history', () => ({ default: () => null }))

it('follows real history through edit, undo and redo', async () => {
  const user = userEvent.setup()
  const handleUndo = vi.fn()
  const handleRedo = vi.fn()
  const { store } = renderWorkflowComponent(
    <UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />,
    { historyStore: {} },
  )
  handleUndo.mockImplementation(() => store.temporal.getState().undo())
  handleRedo.mockImplementation(() => store.temporal.getState().redo())
  const undo = screen.getByRole('button', { name: 'workflow.common.undo' })
  const redo = screen.getByRole('button', { name: 'workflow.common.redo' })
  expect(undo).toHaveAttribute('aria-disabled', 'true')
  expect(redo).toHaveAttribute('aria-disabled', 'true')
  act(() =>
    store.getState().setWorkflowHistory({
      nodes: [createNode({ id: 'added' })],
      edges: [],
      workflowHistoryEvent: undefined,
    }),
  )
  expect(undo).not.toHaveAttribute('aria-disabled', 'true')
  expect(redo).toHaveAttribute('aria-disabled', 'true')
  await user.click(undo)
  expect(store.getState().workflowHistory.nodes).toEqual([])
  expect(undo).toHaveAttribute('aria-disabled', 'true')
  expect(redo).not.toHaveAttribute('aria-disabled', 'true')
  await user.click(redo)
  expect(store.getState().workflowHistory.nodes.map((node) => node.id)).toEqual(['added'])
  expect(handleUndo).toHaveBeenCalledOnce()
  expect(handleRedo).toHaveBeenCalledOnce()
})

it('keeps unavailable actions focusable without activating them', async () => {
  const user = userEvent.setup()
  const handleUndo = vi.fn()
  const handleRedo = vi.fn()
  renderWorkflowComponent(<UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />, {
    historyStore: {},
  })
  await user.tab()
  expect(screen.getByRole('button', { name: 'workflow.common.undo' })).toHaveFocus()
  await user.keyboard('{Enter}')
  await user.tab()
  expect(screen.getByRole('button', { name: 'workflow.common.redo' })).toHaveFocus()
  await user.keyboard(' ')
  expect(handleUndo).not.toHaveBeenCalled()
  expect(handleRedo).not.toHaveBeenCalled()
})

it('blocks available history actions when the canvas becomes read only', async () => {
  const user = userEvent.setup()
  const handleUndo = vi.fn()
  const handleRedo = vi.fn()
  const { store } = renderWorkflowComponent(
    <UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />,
    { historyStore: {} },
  )
  act(() => {
    store.getState().setWorkflowHistory({
      nodes: [createNode({ id: 'first' })],
      edges: [],
      workflowHistoryEvent: undefined,
    })
    store.getState().setWorkflowHistory({
      nodes: [createNode({ id: 'second' })],
      edges: [],
      workflowHistoryEvent: undefined,
    })
    store.temporal.getState().undo()
    store.setState({ canvasReadOnly: true })
  })
  for (const name of ['workflow.common.undo', 'workflow.common.redo']) {
    const action = screen.getByRole('button', { name })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    await user.click(action)
  }
  expect(handleUndo).not.toHaveBeenCalled()
  expect(handleRedo).not.toHaveBeenCalled()
})
