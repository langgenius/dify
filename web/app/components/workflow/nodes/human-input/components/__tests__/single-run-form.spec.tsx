import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { UserActionButtonType } from '../../types'
import SingleRunForm from '../single-run-form'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  __esModule: true,
  default: ({
    content,
    formInputFields,
    inputs,
    onInputChange,
  }: {
    content: string
    formInputFields: FormInputItem[]
    inputs: Record<string, HumanInputFieldValue>
    onInputChange: (name: string, value: HumanInputFieldValue) => void
  }) => {
    const fieldName = /\{\{#\$output\.([^#]+)#\}\}/.exec(content)?.[1]
    if (!fieldName)
      return <div>{content}</div>

    const field = formInputFields.find(field => field.output_variable_name === fieldName)
    if (!field)
      return null

    if (field.type === 'select') {
      return (
        <select
          aria-label={fieldName}
          value={typeof inputs[fieldName] === 'string' ? inputs[fieldName] : ''}
          onChange={event => onInputChange(fieldName, event.target.value)}
        >
          <option value="">Select</option>
          {field.option_source.value.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )
    }

    if (field.type === 'paragraph') {
      return (
        <textarea
          aria-label={fieldName}
          value={typeof inputs[fieldName] === 'string' ? inputs[fieldName] : ''}
          onChange={event => onInputChange(fieldName, event.target.value)}
        />
      )
    }

    return <div>{fieldName}</div>
  },
}))

const createFormData = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-1',
  node_title: 'Review',
  form_content: 'Please review {{#$output.review#}}',
  inputs: [{
    type: InputVarType.paragraph,
    output_variable_name: 'review',
    default: {
      selector: [],
      type: 'constant',
      value: 'initial review',
    },
  }],
  actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }],
  form_token: 'token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 0,
  ...overrides,
})

describe('SingleRunForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the back action as a named button and forwards clicks', async () => {
    const user = userEvent.setup()
    const handleBack = vi.fn()

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData()}
        showBackButton
        handleBack={handleBack}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.humanInput.singleRun.back' }))

    expect(handleBack).toHaveBeenCalledTimes(1)
  })

  it('submits the selected action with initialized inputs', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData()}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        inputs: { review: 'initial review' },
        action: 'approve',
      })
    })
  })

  it('submits updated paragraph input values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData()}
        onSubmit={onSubmit}
      />,
    )

    await user.clear(screen.getByRole('textbox', { name: 'review' }))
    await user.type(screen.getByRole('textbox', { name: 'review' }), 'updated review')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        inputs: { review: 'updated review' },
        action: 'approve',
      })
    })
  })

  it('uses resolved default values for variable paragraph inputs', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData({
          inputs: [{
            type: InputVarType.paragraph,
            output_variable_name: 'review',
            default: {
              selector: ['source', 'answer'],
              type: 'variable',
              value: 'fallback review',
            },
          }],
          resolved_default_values: {
            review: 'resolved review',
          },
        })}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        inputs: { review: 'resolved review' },
        action: 'approve',
      })
    })
  })

  it('disables submit actions until a select input has a value', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData({
          form_content: 'Choose {{#$output.choice#}}',
          inputs: [{
            type: InputVarType.select,
            output_variable_name: 'choice',
            option_source: {
              selector: [],
              type: 'constant',
              value: ['approve', 'reject'],
            },
          }],
        })}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()

    await user.selectOptions(screen.getByRole('combobox', { name: 'choice' }), 'approve')
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        inputs: { choice: 'approve' },
        action: 'approve',
      })
    })
  })
})
