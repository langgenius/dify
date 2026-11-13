import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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
  it('saves both upload methods as the existing array representation', async () => {
    const onSubmit = vi.fn()
    await render(<UploadMethodForm onSubmit={onSubmit} />)

    await expect.element(page.getByRole('radiogroup', { name: 'Upload methods' })).toBeVisible()
    await userEvent.tab()
    await expect
      .element(page.getByRole('radio', { name: 'appDebug.variableConfig.localUpload' }))
      .toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(page.getByRole('radio', { name: 'URL' })).toBeChecked()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(page.getByRole('radio', { name: 'appDebug.variableConfig.both' }))
      .toBeChecked()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect
      .poll(() => onSubmit.mock.calls)
      .toEqual([[[TransferMethod.local_file, TransferMethod.remote_url]]])
  })

  it('lets users select a card by its visible label and saves only URL upload', async () => {
    const onSubmit = vi.fn()
    await render(<UploadMethodForm onSubmit={onSubmit} />)

    await page.getByRole('radio', { name: 'URL' }).click()
    await expect.element(page.getByRole('radio', { name: 'URL' })).toBeChecked()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => onSubmit.mock.calls).toEqual([[[TransferMethod.remote_url]]])
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
