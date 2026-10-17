import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { toast } from '@/app/notifications'
import Options from '../options'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const Submit = ({ form }: CustomActionsProps) => (
  <button type="button" onClick={() => form.handleSubmit()}>
    Process
  </button>
)

it('validates the edited field and submits its current value after correction', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(
    <Options
      initialData={{ source: 'original' }}
      configurations={[
        {
          variable: 'source',
          label: 'Source',
          type: BaseFieldType.textInput,
          required: true,
          showConditions: [],
        },
      ]}
      schema={z.object({ source: z.string().min(1, 'Source is required') })}
      CustomActions={Submit}
      onSubmit={onSubmit}
    />,
  )
  const input = screen.getByRole('textbox', { name: /Source/ })
  expect(input).toHaveValue('original')
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: 'Process' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('Path: source Error: Source is required'),
  )
  expect(onSubmit).not.toHaveBeenCalled()
  await user.type(input, 'corrected')
  await user.click(screen.getByRole('button', { name: 'Process' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ source: 'corrected' }))
})
