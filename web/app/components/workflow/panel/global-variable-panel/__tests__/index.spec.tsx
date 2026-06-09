import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Panel from '../index'

let mockIsChatMode = true
let mockIsWorkflowPage = false
const mockSetShowGlobalVariablePanel = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { setShowGlobalVariablePanel: (visible: boolean) => void }) => unknown) => selector({
    setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
  }),
}))

vi.mock('../../../constants', () => ({
  isInWorkflowPage: () => mockIsWorkflowPage,
}))

vi.mock('../../../hooks', () => ({
  useIsChatMode: () => mockIsChatMode,
}))

describe('global-variable-panel path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = true
    mockIsWorkflowPage = false
  })

  it('should render chat global variables and close the panel', async () => {
    const user = userEvent.setup()
    const { container } = render(<Panel />)

    expect(screen.getByText('workflow.globalVar.title')).toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'sys.conversation_id')).toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'sys.dialog_count')).toBeInTheDocument()
    expect(screen.queryByText('sys.timestamp')).not.toBeInTheDocument()

    await user.click(container.querySelector('.cursor-pointer') as HTMLElement)

    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
  })

  it('should render workflow trigger variables for non-chat workflow pages', () => {
    mockIsChatMode = false
    mockIsWorkflowPage = true

    render(<Panel />)

    expect(screen.queryByText('sys.conversation_id')).not.toBeInTheDocument()
    expect(screen.queryByText('sys.dialog_count')).not.toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'sys.timestamp')).toBeInTheDocument()
    expect(screen.getByText('workflow.globalVar.fieldsDescription.triggerTimestamp')).toBeInTheDocument()
  })
})
