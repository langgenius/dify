import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from './__tests__/workflow-test-env'
import EdgeContextmenu from './edge-contextmenu'

const hookMocks = vi.hoisted(() => ({
  handleEdgeDelete: vi.fn(),
  handleEdgeContextmenuCancel: vi.fn(),
}))

vi.mock('./hooks', () => ({
  useEdgesInteractions: () => ({
    handleEdgeDelete: hookMocks.handleEdgeDelete,
  }),
  usePanelInteractions: () => ({
    handleEdgeContextmenuCancel: hookMocks.handleEdgeContextmenuCancel,
  }),
}))

describe('EdgeContextmenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when edgeMenu is absent', () => {
    renderWorkflowComponent(<EdgeContextmenu />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should open delete action and trigger edge deletion when clicked', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<EdgeContextmenu />, {
      initialStoreState: {
        edgeMenu: {
          x: 320,
          y: 180,
          edgeId: 'edge-1',
        },
      },
    })

    const deleteAction = await screen.findByRole('menuitem', { name: /common:operation\.delete/i })
    expect(deleteAction).toBeInTheDocument()
    expect(screen.queryByText(/^del$/i)).not.toBeInTheDocument()

    await user.click(deleteAction)

    expect(hookMocks.handleEdgeDelete).toHaveBeenCalledTimes(1)
    expect(hookMocks.handleEdgeContextmenuCancel).toHaveBeenCalled()
  })
})
