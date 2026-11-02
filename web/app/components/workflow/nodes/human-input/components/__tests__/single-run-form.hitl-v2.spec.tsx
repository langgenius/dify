import type { HumanInputFormData } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { UserActionButtonType } from '../../types'
import SingleRunForm from '../single-run-form'

const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: mockToastError } }))

const createFormData = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-1',
  node_title: 'Review',
  form_content: 'Please review {{#$output.review#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'review',
      default: {
        selector: [],
        type: 'constant',
        value: 'initial review',
      },
    },
  ],
  actions: [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
  ],
  form_token: 'token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 0,
  ...overrides,
})

describe('SingleRunForm', () => {
  it('restores the submit action and keeps entered values after a server failure', async () => {
    const user = userEvent.setup()
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Submission unavailable'))
      .mockResolvedValue(undefined)
    render(<SingleRunForm nodeName="Review" data={createFormData()} onSubmit={onSubmit} />)
    await user.clear(screen.getByRole('textbox', { name: 'review' }))
    await user.type(screen.getByRole('textbox', { name: 'review' }), 'Keep this answer')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled())
    expect(mockToastError).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'review' })).toHaveValue('Keep this answer')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onSubmit).toHaveBeenLastCalledWith({
      action: 'approve',
      inputs: { review: 'Keep this answer' },
    })
  })
})
