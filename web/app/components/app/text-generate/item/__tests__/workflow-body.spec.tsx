import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import WorkflowBody from '../workflow-body'

const mockSubmit = vi.fn()
const mockSwitchTab = vi.fn()
vi.mock('@/app/components/base/chat/chat/answer/workflow-process', () => ({
  default: () => <div>workflow-process</div>,
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-form-list', () => ({
  default: ({ onHumanInputFormSubmit }: { onHumanInputFormSubmit: typeof mockSubmit }) => (
    <button
      onClick={() =>
        onHumanInputFormSubmit('token-1', { inputs: { name: 'dify' }, action: 'submit' })
      }
    >
      submit-human-input
    </button>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-filled-form-list', () => ({
  default: () => <div>filled-human-input</div>,
}))

vi.mock('../result-tab', () => ({
  default: ({ currentTab }: { currentTab: string }) => <div>{`result-tab:${currentTab}`}</div>,
}))

describe('WorkflowBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render workflow information and allow tab switching', async () => {
    const user = userEvent.setup()
    render(
      <WorkflowBody
        content="detail"
        currentTab="RESULT"
        depth={2}
        isError={false}
        onSubmitHumanInputForm={mockSubmit}
        onSwitchTab={mockSwitchTab}
        showResultTabs
        siteInfo={{ title: 'Test app', show_workflow_steps: true }}
        taskId="task-1"
        workflowProcessData={createWorkflowProcessFixture({
          resultText: 'done',
          humanInputFormDataList: [createHumanInputFormFixture()],
          humanInputFilledFormDataList: [
            {
              node_id: 'filled-1',
              node_title: 'Human Input',
              rendered_content: '',
              action_id: 'submit',
              action_text: 'Submit',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('workflow-process')).toBeInTheDocument()
    expect(screen.getByText('task-1-1')).toBeInTheDocument()
    expect(screen.getByText('result-tab:RESULT')).toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)detail(?=$|:)/))

    expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
  })

  it('should forward human input submissions', async () => {
    const user = userEvent.setup()
    render(
      <WorkflowBody
        content="detail"
        currentTab="RESULT"
        depth={1}
        isError={false}
        onSubmitHumanInputForm={mockSubmit}
        onSwitchTab={mockSwitchTab}
        showResultTabs
        siteInfo={null}
        workflowProcessData={createWorkflowProcessFixture({
          resultText: 'done',
          humanInputFormDataList: [createHumanInputFormFixture()],
        })}
      />,
    )

    await user.click(screen.getByText('submit-human-input'))

    expect(mockSubmit).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { name: 'dify' },
    })
  })
})
