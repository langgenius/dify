import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import PublishToast from '../publish-toast'

describe('PublishToast', () => {
  it('does not show the unpublished notice for a published pipeline', () => {
    renderWorkflowComponent(<PublishToast />, { initialStoreState: { publishedAt: 1 } })

    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  })

  it('hides the notice once the pipeline gets published', () => {
    const { store } = renderWorkflowComponent(<PublishToast />)
    expect(screen.getByText('pipeline.publishToast.desc')).toBeInTheDocument()

    act(() => store.getState().setPublishedAt(1_700_000_000))

    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  })

  it('allows keyboard users to dismiss the notice and keeps it dismissed on rerender', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWorkflowComponent(<PublishToast />)
    expect(screen.getByText('pipeline.publishToast.desc')).toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()

    rerender(<PublishToast />)
    expect(screen.queryByText('pipeline.publishToast.title')).not.toBeInTheDocument()
  })
})
