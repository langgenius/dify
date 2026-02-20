import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BaseForm from './index'
import { BaseFieldType } from './types'

const baseConfigurations = [{
  type: BaseFieldType.textInput,
  variable: 'name',
  label: 'Name',
  required: false,
  showConditions: [],
}]

describe('BaseForm', () => {
  it('should render configured fields', () => {
    render(
      <BaseForm
        initialData={{ name: 'Alice' }}
        configurations={[...baseConfigurations]}
        onSubmit={() => {}}
      />,
    )

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument()
  })

  it('should submit current form values when submit button is clicked', async () => {
    const onSubmit = vi.fn()
    render(
      <BaseForm
        initialData={{ name: 'Alice' }}
        configurations={[...baseConfigurations]}
        onSubmit={onSubmit}
        CustomActions={({ form }) => (
          <button type="button" onClick={() => form.handleSubmit()}>
            Submit
          </button>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'Alice' })
    })
  })

  it('should render custom actions when provided', () => {
    render(
      <BaseForm
        initialData={{ name: 'Alice' }}
        configurations={[...baseConfigurations]}
        onSubmit={() => {}}
        CustomActions={() => <button type="button">Save Form</button>}
      />,
    )

    expect(screen.getByRole('button', { name: /save form/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common.operation.submit/i })).not.toBeInTheDocument()
  })

  it('should handle native form submit and block invalid submission', async () => {
    const onSubmit = vi.fn()
    const requiredConfig = [{
      type: BaseFieldType.textInput,
      variable: 'name',
      label: 'Name',
      required: true,
      showConditions: [],
      maxLength: 2,
    }]
    const { container } = render(
      <BaseForm
        initialData={{ name: 'ok' }}
        configurations={requiredConfig}
        onSubmit={onSubmit}
      />,
    )

    const form = container.querySelector('form')
    const input = screen.getByRole('textbox')
    expect(form).not.toBeNull()

    fireEvent.submit(form!)
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'ok' })
    })

    fireEvent.change(input, { target: { value: 'long' } })
    fireEvent.submit(form!)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
