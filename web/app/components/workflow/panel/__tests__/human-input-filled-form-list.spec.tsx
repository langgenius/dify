import type { HumanInputFilledFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HumanInputFilledFormList from '../human-input-filled-form-list'

const createFilledForm = (
  overrides: Partial<HumanInputFilledFormData> = {},
): HumanInputFilledFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Approval',
  rendered_content: 'Approved by Alice',
  action_id: 'approve',
  action_text: 'Approve',
  submitted_data: {
    summary: 'Approved by Alice',
  },
  ...overrides,
})

describe('HumanInputFilledFormList', () => {
  it('renders submitted form content and toggles expansion', async () => {
    const user = userEvent.setup()

    const first = createFilledForm()
    const second = createFilledForm({
      form_id: 'form-2',
      node_title: 'Review',
      rendered_content: 'Reviewed by Bob',
      action_id: 'review',
      action_text: 'Review',
    })
    const { rerender } = render(
      <HumanInputFilledFormList humanInputFilledFormDataList={[first, second]} />,
    )

    expect(screen.getByText('Approval'))!.toBeInTheDocument()
    expect(screen.getByText('Review'))!.toBeInTheDocument()
    expect(screen.getAllByTestId('submitted-field-values')).toHaveLength(2)
    expect(screen.getAllByTestId('executed-action')).toHaveLength(2)
    expect(screen.getAllByTestId('submitted-field-summary')).toHaveLength(2)
    expect(screen.getAllByTestId('submitted-field-summary')[0]).toHaveTextContent(
      'Approved by Alice',
    )

    const collapseApproval = screen.getByRole('button', {
      name: 'share.chat.collapse Approval',
    })
    await user.click(collapseApproval)

    expect(collapseApproval).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('submitted-field-values')).toHaveLength(1)

    rerender(<HumanInputFilledFormList humanInputFilledFormDataList={[second, first]} />)
    expect(screen.getByRole('button', { name: /Approval/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /Review/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
