import SyncingDataModal from '../syncing-data-modal'
import { renderWorkflowComponent } from './workflow-test-env'

describe('SyncingDataModal', () => {
  it('should not render when workflow draft syncing is disabled', () => {
    const { container } = renderWorkflowComponent(<SyncingDataModal />)

    expect(container).toBeEmptyDOMElement()
  })

  it('should render the fullscreen overlay when workflow draft syncing is enabled', () => {
    const { container } = renderWorkflowComponent(<SyncingDataModal />, {
      initialStoreState: {
        isSyncingWorkflowDraft: true,
      },
    })

    const overlay = container.firstElementChild
    expect(overlay).toHaveClass('absolute', 'inset-0')
    expect(overlay).toHaveClass('z-9999')
  })
})
