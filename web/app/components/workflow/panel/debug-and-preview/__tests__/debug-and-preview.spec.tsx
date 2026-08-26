import type { Ref } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle } from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import DebugAndPreview from '../index'

const mockHandleRestart = vi.fn()
const mockHandleNodeCancelRunningStatus = vi.fn()
const mockHandleEdgeCancelRunningStatus = vi.fn()
const mockHandleCancelDebugAndPreviewPanel = vi.fn()

vi.mock('reactflow', () => ({
  useNodes: () => [
    {
      data: {
        type: 'start',
        variables: [{ label: 'Topic', variable: 'topic' }],
      },
      id: 'start',
    },
  ],
}))

vi.mock('../../../hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

vi.mock('../../../hooks/use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({
    handleNodeCancelRunningStatus: mockHandleNodeCancelRunningStatus,
  }),
}))

vi.mock('../../../hooks/use-edges-interactions-without-sync', () => ({
  useEdgesInteractionsWithoutSync: () => ({
    handleEdgeCancelRunningStatus: mockHandleEdgeCancelRunningStatus,
  }),
}))

vi.mock('../../../nodes/_base/hooks/use-resize-panel', () => ({
  useResizePanel: () => ({
    containerRef: vi.fn(),
    triggerRef: vi.fn(),
  }),
}))

vi.mock('../../../persistence/local-storage-options', () => ({
  useSetDebugPreviewPanelWidth: () => vi.fn(),
}))

vi.mock('../chat-wrapper', () => ({
  default: function MockChatWrapper({ ref }: { ref: Ref<{ handleRestart: () => void }> }) {
    useImperativeHandle(ref, () => ({ handleRestart: mockHandleRestart }))
    return <div>Chat</div>
  },
}))

describe('DebugAndPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes and invokes the restart action by name', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<DebugAndPreview />, {
      initialStoreState: {
        previewPanelWidth: 400,
      },
    })

    await user.click(screen.getByRole('button', { name: /operation\.refresh/ }))

    expect(mockHandleNodeCancelRunningStatus).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeCancelRunningStatus).toHaveBeenCalledTimes(1)
    expect(mockHandleRestart).toHaveBeenCalledTimes(1)
  })

  it('exposes the user input field toggle state by name', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<DebugAndPreview />, {
      initialStoreState: {
        previewPanelWidth: 400,
      },
    })
    const toggle = screen.getByRole('button', { name: /panel\.userInputField/ })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the panel through a named keyboard action', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<DebugAndPreview />, {
      initialStoreState: {
        previewPanelWidth: 400,
      },
    })

    const closeButton = screen.getByRole('button', { name: /operation\.close/ })
    closeButton.focus()

    expect(closeButton).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })
})
