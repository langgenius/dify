import { screen } from '@testing-library/react'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import Panel from '../index'

let mockIsWorkflowPage = false
const mockSetShowGlobalVariablePanel = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (
    selector: (state: { setShowGlobalVariablePanel: (visible: boolean) => void }) => unknown,
  ) =>
    selector({
      setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
    }),
}))

vi.mock('../../../constants', () => ({
  isInWorkflowPage: () => mockIsWorkflowPage,
}))

describe('global-variable-panel path', () => {
  beforeEach(() => {
    mockIsWorkflowPage = false
  })

  it('should render workflow trigger variables for non-chat workflow pages', () => {
    mockIsWorkflowPage = true

    render(<Panel />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    expect(screen.queryByText('sys.conversation_id')).not.toBeInTheDocument()
    expect(screen.queryByText('sys.dialog_count')).not.toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'sys.timestamp')).toBeInTheDocument()
    expect(
      screen.getByText('workflow.globalVar.fieldsDescription.triggerTimestamp'),
    ).toBeInTheDocument()
  })
})
