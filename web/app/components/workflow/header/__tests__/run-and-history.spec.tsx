import { render, screen } from '@testing-library/react'
import RunAndHistory from '../run-and-history'

const mockState = vi.hoisted(() => ({
  canRun: true,
  nodesReadOnly: false,
}))
const mockRunMode = vi.hoisted(() => vi.fn())
const mockHandleWorkflowStartRunInChatflow = vi.hoisted(() => vi.fn())

vi.mock('../../hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: mockState.nodesReadOnly }),
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInChatflow: mockHandleWorkflowStartRunInChatflow,
  }),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { accessControl: { canRun: boolean } }) => T): T =>
    selector({
      accessControl: {
        canRun: mockState.canRun,
      },
    }),
}))

vi.mock('../run-mode', () => ({
  default: ({ text, disabled }: { text?: string, disabled?: boolean }) => {
    mockRunMode({ text, disabled })

    return (
      <button type="button" disabled={disabled}>
        {text ?? 'workflow.common.run'}
      </button>
    )
  },
}))

vi.mock('../view-history', () => ({
  default: () => <button type="button">History</button>,
}))

vi.mock('../checklist', () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <button type="button" disabled={disabled}>
      Checklist
    </button>
  ),
}))

describe('RunAndHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.canRun = true
    mockState.nodesReadOnly = false
  })

  it('should keep the test run button visible and disabled when workflow run permission is denied', () => {
    mockState.canRun = false

    render(<RunAndHistory showRunButton runButtonText="Test Run" />)

    expect(screen.getByRole('button', { name: 'Test Run' })).toBeDisabled()
    expect(mockRunMode).toHaveBeenCalledWith({
      text: 'Test Run',
      disabled: true,
    })
  })

  it('should keep the preview button visible and disabled when workflow run permission is denied', () => {
    mockState.canRun = false

    render(<RunAndHistory showPreviewButton />)

    expect(screen.getByRole('button', { name: 'workflow.common.debugAndPreview' })).toBeDisabled()
  })
})
