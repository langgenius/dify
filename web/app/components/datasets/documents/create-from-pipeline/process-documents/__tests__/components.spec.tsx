import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import * as z from 'zod'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import Form from '../form'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error: toastError } }))

const configurations: BaseConfiguration[] = [
  {
    type: BaseFieldType.textInput,
    variable: 'separator',
    label: 'Separator',
    required: false,
    showConditions: [],
    placeholder: '',
    tooltip: '',
  },
]

const setup = () => {
  const ref = createRef<{ submit: () => void }>()
  const onSubmit = vi.fn()
  render(
    <Form
      ref={ref}
      initialData={{ separator: '---' }}
      configurations={configurations}
      schema={z.object({ separator: z.string().min(1, 'is required') })}
      onSubmit={onSubmit}
      onPreview={vi.fn()}
      isRunning={false}
    />,
  )
  return { ref, onSubmit }
}

// ProcessDocuments owns action routing and running/loading gates. These cases
// cover the form's value reset and schema validation with real inputs.
describe('Processing form', () => {
  it('resets edited fields to the initial values before submission', async () => {
    const user = userEvent.setup()
    const { ref, onSubmit } = setup()
    const input = screen.getByRole('textbox')
    const reset = screen.getByRole('button', { name: 'common.operation.reset' })
    expect(reset).toBeDisabled()
    await user.clear(input)
    await user.type(input, '|||')
    expect(reset).toBeEnabled()
    await user.click(reset)
    expect(input).toHaveValue('---')
    expect(reset).toBeDisabled()
    await act(async () => ref.current!.submit())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ separator: '---' }))
  })

  it('rejects an invalid field and submits after the user corrects it', async () => {
    const user = userEvent.setup()
    const { ref, onSubmit } = setup()
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await act(async () => ref.current!.submit())
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('"separator" is required'))
    expect(onSubmit).not.toHaveBeenCalled()
    await user.type(input, '|||')
    await act(async () => ref.current!.submit())
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ separator: '|||' }))
  })
})
