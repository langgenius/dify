import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import ImageUpload from '../index'

vi.unmock('react-i18next')
beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('saves image-only defaults through the real settings owner and returns to its summary', async () => {
  const { screen, store } = await renderFeature(<ImageUpload disabled={false} />, {
    file: { enabled: true },
  })
  await expect.element(screen.getByText('-', { exact: true })).toBeVisible()
  await screen.getByRole('switch', { name: /Image Upload/ }).hover()
  await screen.getByRole('button', { name: 'Settings' }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByText('Image Upload Setting')).toBeVisible()
  await expect.element(dialog.getByRole('checkbox')).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('radio', { name: 'Both' })).toBeChecked()
  await expect.element(dialog.getByRole('spinbutton')).toHaveValue(3)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await userEvent.unhover(document.body)
  await expect.element(screen.getByText('-', { exact: true })).toBeVisible()
  await screen.getByRole('switch', { name: /Image Upload/ }).hover()
  await screen.getByRole('button', { name: 'Settings' }).click()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await userEvent.unhover(document.body)
  await expect.element(screen.getByText('image', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('3', { exact: true })).toBeVisible()
  expect(store.getState().features.file).toMatchObject({
    allowed_file_types: ['image'],
    number_limits: 3,
    allowed_file_upload_methods: ['local_file', 'remote_url'],
  })
})

it('persists the legacy image toggle and prevents editing when disabled', async () => {
  const { screen, store, rerender } = await renderFeature(<ImageUpload disabled={false} />, {
    file: { enabled: false },
  })
  const toggle = screen.getByRole('switch', { name: /Image Upload/ })
  await toggle.click()
  await expect.element(toggle).toBeChecked()
  expect(store.getState().features.file).toMatchObject({ enabled: true, image: { enabled: true } })
  await rerender(<ImageUpload disabled />)
  await expect.element(toggle).toBeDisabled()
  await screen.getByRole('switch', { name: /Image Upload/ }).hover()
  await expect.element(screen.getByRole('button', { name: 'Settings' })).toBeDisabled()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(store.getState().features.file?.enabled).toBe(true)
})
