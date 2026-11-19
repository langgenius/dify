import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import { renderFeature, savedFile } from '../../__tests__/feature-browser-test-env'
import FileUploadSettings from '../setting-modal'

vi.unmock('react-i18next')
beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

function Settings({
  disabled = false,
  imageUpload = false,
}: {
  disabled?: boolean
  imageUpload?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <FileUploadSettings open={open} onOpen={setOpen} disabled={disabled} imageUpload={imageUpload}>
      <button type="button">Upload Settings</button>
    </FileUploadSettings>
  )
}

it.each(['Cancel', 'Close'])(
  'discards a local draft through %s, then commits the next edit before closing',
  async (action) => {
    const { screen, store } = await renderFeature(<Settings />, { file: savedFile })
    const trigger = screen.getByRole('button', { name: 'Upload Settings' })
    await trigger.click()
    let dialog = screen.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'URL', exact: true }).click()
    await dialog.getByRole('spinbutton').fill('2')
    expect(store.getState().features.file).toEqual(savedFile)
    await dialog.getByRole('button', { name: action, exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(store.getState().features.file).toEqual(savedFile)
    await userEvent.keyboard('{Enter}')
    dialog = screen.getByRole('dialog')
    await expect.element(dialog.getByRole('spinbutton')).toHaveValue(5)
    await expect
      .element(dialog.getByRole('radio', { name: 'Local Upload', exact: true }))
      .toBeChecked()
    await dialog.getByRole('radio', { name: 'URL', exact: true }).click()
    await dialog.getByRole('checkbox', { name: 'Document', exact: true }).click()
    await dialog.getByRole('spinbutton').fill('2')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(store.getState().features.file).toEqual({
      ...savedFile,
      allowed_file_upload_methods: [TransferMethod.remote_url],
      allowed_file_types: ['image', 'document'],
      number_limits: 2,
    })
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('spinbutton')).toHaveValue(2)
    await expect.element(screen.getByRole('radio', { name: 'URL', exact: true })).toBeChecked()
  },
)

it('requires a supported file type before the saved draft can change', async () => {
  const { screen, store } = await renderFeature(<Settings />, { file: savedFile })
  await screen.getByRole('button', { name: 'Upload Settings' }).click()
  await screen.getByRole('checkbox', { name: 'Image', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  expect(store.getState().features.file).toEqual(savedFile)
  await screen.getByRole('checkbox', { name: 'Document', exact: true }).click()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(store.getState().features.file?.allowed_file_types).toEqual(['document'])
})

it('keeps the settings surface closed when its trigger is disabled', async () => {
  const { screen } = await renderFeature(<Settings disabled />)
  await expect.element(screen.getByRole('button', { name: 'Upload Settings' })).toBeDisabled()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Upload Settings' })).not.toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
