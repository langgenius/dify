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
  it('keeps each submitted form expanded or collapsed when same-node forms reorder', async () => {
    const user = userEvent.setup()

    const first = createFilledForm()
    const second = createFilledForm({
      form_id: 'form-2',
      node_title: 'Review',
      rendered_content: 'Reviewed by Bob',
      action_id: 'review',
      action_text: 'Review',
      submitted_data: { summary: 'Reviewed by Bob' },
    })
    const { rerender } = render(
      <HumanInputFilledFormList humanInputFilledFormDataList={[first, second]} />,
    )

    expect(screen.getByText('Approved by Alice')).toBeInTheDocument()
    expect(screen.getByText('Reviewed by Bob')).toBeInTheDocument()

    const collapseApproval = screen.getByRole('button', {
      name: 'share.chat.collapse Approval',
    })
    await user.click(collapseApproval)

    expect(collapseApproval).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Approved by Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Reviewed by Bob')).toBeInTheDocument()

    rerender(<HumanInputFilledFormList humanInputFilledFormDataList={[second, first]} />)
    expect(screen.getByRole('button', { name: /Approval/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /Review/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
