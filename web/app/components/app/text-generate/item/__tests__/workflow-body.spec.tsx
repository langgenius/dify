import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import WorkflowBody from '../workflow-body'

const mockSubmit = vi.fn().mockResolvedValue(undefined)
const mockSwitchTab = vi.fn()
const form = createHumanInputFormFixture({
  form_content: 'Name: {{#$output.name#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'name',
      default: { type: 'constant', value: '', selector: [] },
    },
  ],
  actions: [{ id: 'submit', title: 'Submit', button_style: UserActionButtonType.Primary }],
})

describe('WorkflowBody', () => {
  it('should render workflow information and allow tab switching', async () => {
    const user = userEvent.setup()
    function Scenario() {
      const [tab, setTab] = useState('RESULT')
      return (
        <WorkflowBody
          content="detail"
          currentTab={tab}
          depth={2}
          isError={false}
          onSubmitHumanInputForm={mockSubmit}
          onSwitchTab={setTab}
          showResultTabs
          siteInfo={{ title: 'Test app', show_workflow_steps: true }}
          taskId="task-1"
          workflowProcessData={createWorkflowProcessFixture({
            resultText: 'done',
          })}
        />
      )
    }
    render(<Scenario />)

    expect(screen.getByRole('button', { name: /workflowProcessSucceeded/ })).toBeInTheDocument()
    expect(screen.getByText('task-1-1')).toBeInTheDocument()
    expect(await screen.findByText('done')).toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)detail(?=$|:)/))

    expect(screen.queryByText('done')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify('detail', null, 2))
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
          humanInputFormDataList: [form],
        })}
      />,
    )

    await user.type(screen.getByRole('textbox'), 'dify')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(mockSubmit).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { name: 'dify' },
    })
  })
})
