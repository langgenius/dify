import type { HumanInputFilledFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HumanInputFilledFormList from '../human-input-filled-form-list'

const createFilledForm = (overrides: Partial<HumanInputFilledFormData> = {}): HumanInputFilledFormData => ({
  node_id: 'node-1',
  node_title: 'Approval',
  rendered_content: 'Approved by Alice',
  action_id: 'approve',
  action_text: 'Approve',
  ...overrides,
})

describe('HumanInputFilledFormList', () => {
  it('renders submitted form content and toggles expansion', async () => {
    const user = userEvent.setup()

    render(
      <HumanInputFilledFormList
        humanInputFilledFormDataList={[
          createFilledForm(),
          createFilledForm({
            node_id: 'node-2',
            node_title: 'Review',
            rendered_content: 'Reviewed by Bob',
            action_id: 'review',
            action_text: 'Review',
          }),
        ]}
      />,
    )

    expect(screen.getByText('Approval'))!.toBeInTheDocument()
    expect(screen.getByText('Review'))!.toBeInTheDocument()
    expect(screen.getAllByTestId('submitted-content')).toHaveLength(2)
    expect(screen.getAllByTestId('executed-action')).toHaveLength(2)

    await user.click(screen.getAllByTestId('expand-icon')[0]!)

    expect(screen.getAllByTestId('submitted-content')).toHaveLength(1)
  })
})
