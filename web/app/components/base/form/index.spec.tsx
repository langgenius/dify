import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAppForm, withForm } from './index'

const FormHarness = ({ onSubmit }: { onSubmit: (value: Record<string, unknown>) => void }) => {
  const form = useAppForm({
    defaultValues: { title: 'Initial title' },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form>
      <form.AppField
        name="title"
        children={field => <field.TextField label="Title" />}
      />
      <form.AppForm>
        <button type="button" onClick={() => form.handleSubmit()}>
          Submit
        </button>
      </form.AppForm>
    </form>
  )
}

const InlinePreview = withForm({
  defaultValues: { title: '' },
  render: ({ form }) => {
    return (
      <form.AppField
        name="title"
        children={field => <field.TextField label="Preview Title" />}
      />
    )
  },
})

const WithFormHarness = () => {
  const form = useAppForm({
    defaultValues: { title: 'Preview value' },
    onSubmit: () => {},
  })

  return <InlinePreview form={form} />
}

describe('form index exports', () => {
  it('should submit values through the generated app form', async () => {
    const onSubmit = vi.fn()
    render(<FormHarness onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ title: 'Initial title' })
    })
  })

  it('should render components created with withForm', () => {
    render(<WithFormHarness />)

    expect(screen.getByRole('textbox')).toHaveValue('Preview value')
    expect(screen.getByText('Preview Title')).toBeInTheDocument()
  })
})
