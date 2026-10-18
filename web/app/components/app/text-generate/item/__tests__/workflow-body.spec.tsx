import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import WorkflowBody from '../workflow-body'

it('shows pending and completed forms only in a successful result pane', async () => {
  const props: ComponentProps<typeof WorkflowBody> = {
    content: undefined,
    currentTab: 'RESULT',
    depth: 2,
    isError: false,
    onSubmitHumanInputForm: vi.fn().mockResolvedValue(undefined),
    onSwitchTab: vi.fn(),
    showResultTabs: true,
    siteInfo: null,
    taskId: 'task-1',
    workflowProcessData: createWorkflowProcessFixture({
      resultText: 'Finished result',
      humanInputFormDataList: [
        createHumanInputFormFixture({
          actions: [
            { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          ],
        }),
      ],
      humanInputFilledFormDataList: [
        {
          node_id: 'filled-1',
          node_title: 'Completed approval',
          rendered_content: '',
          action_id: 'submit',
          action_text: 'Submit',
        },
      ],
    }),
  }
  const { rerender } = render(<WorkflowBody {...props} />)
  expect(screen.getByText('task-1-1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  expect(screen.getByText('Completed approval')).toBeInTheDocument()
  expect(await screen.findByText('Finished result')).toBeInTheDocument()

  rerender(<WorkflowBody {...props} currentTab="DETAIL" />)
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  expect(screen.queryByText('Completed approval')).not.toBeInTheDocument()
  expect(screen.queryByText('Finished result')).not.toBeInTheDocument()

  rerender(<WorkflowBody {...props} isError />)
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  expect(screen.queryByText('Completed approval')).not.toBeInTheDocument()
  expect(screen.queryByText('Finished result')).not.toBeInTheDocument()
})
