import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderFeature, savedFile } from '../../__tests__/feature-browser-test-env'
import FileUpload from '../index'

vi.unmock('react-i18next')
beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('keeps file and legacy image enablement in sync and preserves saved restrictions', async () => {
  const { screen, store, rerender } = await renderFeature(<FileUpload disabled={false} />, {
    file: { ...savedFile, enabled: false },
  })
  const toggle = screen.getByRole('switch', { name: 'File Upload' })
  await toggle.click()
  await expect.element(toggle).toBeChecked()
  expect(store.getState().features.file).toMatchObject({
    ...savedFile,
    enabled: true,
    image: { enabled: true },
  })
  await toggle.click()
  await expect.element(toggle).not.toBeChecked()
  expect(store.getState().features.file).toMatchObject({
    ...savedFile,
    enabled: false,
    image: { enabled: false },
  })
  await rerender(<FileUpload disabled />)
  await expect.element(toggle).toBeDisabled()
  await userEvent.keyboard('{Space}')
  expect(store.getState().features.file?.enabled).toBe(false)
})

it('reveals settings on real hover and restores the saved summary after cancelling', async () => {
  const { screen } = await renderFeature(<FileUpload disabled={false} />, {
    file: { ...savedFile, allowed_file_types: ['image', 'document'] },
  })
  await expect.element(screen.getByText('image,document')).toBeVisible()
  await expect.element(screen.getByText('5', { exact: true })).toBeVisible()
  await screen.getByText('File Upload', { exact: true }).hover()
  await screen.getByRole('button', { name: 'Settings' }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByText('File Upload Setting')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await userEvent.unhover(document.body)
  await expect.element(screen.getByText('image,document')).toBeVisible()
})

it('displays the unconfigured summary without manufacturing file types', async () => {
  const { screen } = await renderFeature(<FileUpload disabled={false} />, {
    file: { enabled: true },
  })
  await expect.element(screen.getByText('-', { exact: true })).toBeVisible()
})
