import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '../index'

const FormHarness = ({ onSubmit }: { onSubmit: (value: Record<string, unknown>) => void }) => {
  const form = useAppForm({
    defaultValues: { title: 'Initial title' },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="title" children={(field) => <field.TextField label="Title" />} />
      <form.AppForm>
        <button type="submit">Submit</button>
      </form.AppForm>
    </form>
  )
}

describe('app form field integration', () => {
  it('should submit values through the generated app form', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<FormHarness onSubmit={onSubmit} />)

    const input = screen.getByRole('textbox', { name: 'Title' })
    await user.clear(input)
    await user.type(input, 'Updated title')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ title: 'Updated title' })
    })
  })
})
