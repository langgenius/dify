import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContextProvider } from '../context'
import { useStore, useWorkflowStore } from '../store'

const StoreConsumer = () => {
  const showSingleRunPanel = useStore(s => s.showSingleRunPanel)
  const store = useWorkflowStore()

  return (
    <button onClick={() => store.getState().setShowSingleRunPanel(!showSingleRunPanel)}>
      {showSingleRunPanel ? 'open' : 'closed'}
    </button>
  )
}

describe('WorkflowContextProvider', () => {
  it('provides the workflow store to descendants and keeps the same store across rerenders', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <WorkflowContextProvider>
        <StoreConsumer />
      </WorkflowContextProvider>,
    )

    expect(screen.getByRole('button', { name: 'closed' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'closed' }))
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()

    rerender(
      <WorkflowContextProvider>
        <StoreConsumer />
      </WorkflowContextProvider>,
    )

    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument()
  })
})
