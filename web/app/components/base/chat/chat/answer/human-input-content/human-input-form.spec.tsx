import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import HumanInputForm from './human-input-form'

vi.mock('./content-item', () => ({
  default: ({ content, onInputChange }: { content: string, onInputChange: (name: string, value: string) => void }) => (
    <div data-testid="mock-content-item">
      {content}
      <button data-testid="update-input" onClick={() => onInputChange('field1', 'new value')}>Update</button>
    </div>
  ),
}))

describe('HumanInputForm', () => {
  const mockFormData: HumanInputFormData = {
    form_id: 'form_1',
    node_id: 'node_1',
    node_title: 'Title',
    display_in_ui: true,
    expiration_time: 0,
    form_token: 'token_123',
    form_content: 'Part 1 {{#$output.field1#}} Part 2',
    inputs: [
      {
        type: 'paragraph',
        output_variable_name: 'field1',
        default: { type: 'constant', value: 'initial', selector: [] },
      } as FormInputItem,
    ],
    actions: [
      { id: 'action_1', title: 'Submit', button_style: UserActionButtonType.Primary },
      { id: 'action_2', title: 'Cancel', button_style: UserActionButtonType.Default },
      { id: 'action_3', title: 'Accent', button_style: UserActionButtonType.Accent },
      { id: 'action_4', title: 'Ghost', button_style: UserActionButtonType.Ghost },
    ],
    resolved_default_values: {},
  }

  it('should render content parts and action buttons', () => {
    render(<HumanInputForm formData={mockFormData} />)

    // splitByOutputVar should yield 3 parts: "Part 1 ", "{{#$output.field1#}}", " Part 2"
    const contentItems = screen.getAllByTestId('mock-content-item')
    expect(contentItems).toHaveLength(3)
    expect(contentItems[0]).toHaveTextContent('Part 1')
    expect(contentItems[1]).toHaveTextContent('{{#$output.field1#}}')
    expect(contentItems[2]).toHaveTextContent('Part 2')

    const buttons = screen.getAllByTestId('action-button')
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toHaveTextContent('Submit')
    expect(buttons[1]).toHaveTextContent('Cancel')
    expect(buttons[2]).toHaveTextContent('Accent')
    expect(buttons[3]).toHaveTextContent('Ghost')
  })

  it('should handle input changes and submit correctly', async () => {
    const user = userEvent.setup()
    const mockOnSubmit = vi.fn().mockResolvedValue(undefined)
    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    // Update input via mock ContentItem
    await user.click(screen.getAllByTestId('update-input')[0])

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Submit' })
    await user.click(submitButton)

    expect(mockOnSubmit).toHaveBeenCalledWith('token_123', {
      action: 'action_1',
      inputs: { field1: 'new value' },
    })
  })

  it('should disable buttons during submission', async () => {
    const user = userEvent.setup()
    let resolveSubmit: (value: void | PromiseLike<void>) => void
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const mockOnSubmit = vi.fn().mockReturnValue(submitPromise)

    render(<HumanInputForm formData={mockFormData} onSubmit={mockOnSubmit} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(cancelButton).toBeDisabled()

    // Finish submission
    await act(async () => {
      resolveSubmit!(undefined)
    })

    expect(submitButton).not.toBeDisabled()
    expect(cancelButton).not.toBeDisabled()
  })

  it('should handle missing resolved_default_values', () => {
    const formDataWithoutDefaults = { ...mockFormData, resolved_default_values: undefined }
    render(<HumanInputForm formData={formDataWithoutDefaults as unknown as HumanInputFormData} />)
    expect(screen.getAllByTestId('mock-content-item')).toHaveLength(3)
  })

  it('should handle unsupported input types in initializeInputs', () => {
    const formDataWithUnsupported = {
      ...mockFormData,
      inputs: [
        {
          type: 'text-input',
          output_variable_name: 'field2',
          default: { type: 'variable', value: '', selector: [] },
        } as FormInputItem,
        {
          type: 'number',
          output_variable_name: 'field3',
          default: { type: 'constant', value: '0', selector: [] },
        } as FormInputItem,
      ],
      resolved_default_values: { field2: 'default value' },
    }
    render(<HumanInputForm formData={formDataWithUnsupported} />)
    expect(screen.getAllByTestId('mock-content-item')).toHaveLength(3)
  })
})
