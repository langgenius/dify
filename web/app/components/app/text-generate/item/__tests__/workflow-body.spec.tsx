/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import WorkflowBody from '../workflow-body'

const mockSubmit = vi.fn()
const mockSwitchTab = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/chat/chat/answer/workflow-process', () => ({
  default: () => <div>workflow-process</div>,
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-form-list', () => ({
  default: ({ onHumanInputFormSubmit }: { onHumanInputFormSubmit: typeof mockSubmit }) => (
    <button onClick={() => onHumanInputFormSubmit('token-1', { inputs: { name: 'dify' }, action: 'submit' })}>
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

  it('should render workflow information and allow tab switching', () => {
    render(
      <WorkflowBody
        content="detail"
        currentTab="RESULT"
        depth={2}
        isError={false}
        onSubmitHumanInputForm={mockSubmit}
        onSwitchTab={mockSwitchTab}
        showResultTabs
        siteInfo={{ show_workflow_steps: true } as any}
        taskId="task-1"
        workflowProcessData={{
          resultText: 'done',
          humanInputFormDataList: [{ formToken: 'token-1' }],
          humanInputFilledFormDataList: [{ id: 'filled-1' }],
        } as any}
      />,
    )

    expect(screen.getByText('workflow-process')).toBeInTheDocument()
    expect(screen.getByText('task-1-1')).toBeInTheDocument()
    expect(screen.getByText('result-tab:RESULT')).toBeInTheDocument()

    fireEvent.click(screen.getByText('detail'))

    expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
  })

  it('should forward human input submissions', () => {
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
        workflowProcessData={{
          resultText: 'done',
          humanInputFormDataList: [{ formToken: 'token-1' }],
        } as any}
      />,
    )

    fireEvent.click(screen.getByText('submit-human-input'))

    expect(mockSubmit).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { name: 'dify' },
    })
  })
})
