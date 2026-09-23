import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { useAppForm } from '../../..'

const UploadMethodForm = ({ onSubmit }: { onSubmit: (value: TransferMethod[]) => void }) => {
  const form = useAppForm({
    defaultValues: { methods: [TransferMethod.local_file] as TransferMethod[] },
    onSubmit: ({ value }) => onSubmit(value.methods),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="methods">
        {(field) => <field.UploadMethodField label="Upload methods" />}
      </form.AppField>
      <button type="submit">Save</button>
    </form>
  )
}

describe('UploadMethodField', () => {
  it('lets keyboard users choose both methods and saves the existing array representation', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<UploadMethodForm onSubmit={onSubmit} />)

    expect(screen.getByRole('radiogroup', { name: 'Upload methods' })).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('radio', { name: 'appDebug.variableConfig.localUpload' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'URL' })).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'appDebug.variableConfig.both' })).toBeChecked()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledWith([TransferMethod.local_file, TransferMethod.remote_url])
  })

  it('lets users select a card by its visible label and saves only URL upload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<UploadMethodForm onSubmit={onSubmit} />)

    await user.click(screen.getByText('URL'))
    expect(screen.getByRole('radio', { name: 'URL' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith([TransferMethod.remote_url])
  })
})
