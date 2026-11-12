import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TtsAutoPlay } from '@/types/app'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import TextToSpeech from '../index'

vi.unmock('react-i18next')
// boundary: the component runs without a Next application router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/configuration' }))

beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('retains voice preferences across disable and enable, then prevents readonly changes', async () => {
  const preferences = {
    enabled: true,
    language: 'en-US',
    voice: 'alloy',
    autoPlay: TtsAutoPlay.enabled,
  }
  const { screen, store, rerender } = await renderFeature(<TextToSpeech disabled={false} />, {
    text2speech: preferences,
  })
  const toggle = screen.getByRole('switch')
  await expect.element(screen.getByText('alloy', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('On', { exact: true })).toBeVisible()
  await toggle.click()
  await expect.element(toggle).not.toBeChecked()
  expect(store.getState().features.text2speech).toEqual({ ...preferences, enabled: false })
  await toggle.click()
  await expect.element(toggle).toBeChecked()
  await userEvent.unhover(document.body)
  await expect.element(screen.getByText('alloy', { exact: true })).toBeVisible()
  expect(store.getState().features.text2speech).toEqual(preferences)
  await screen.getByRole('switch').hover()
  const settings = screen.getByRole('button', { name: 'Voice Settings' })
  await settings.click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('switch').click()
  await expect.element(dialog.getByRole('switch')).not.toBeChecked()
  expect(store.getState().features.text2speech?.autoPlay).toBe(TtsAutoPlay.disabled)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.getByRole('switch').hover()
  await settings.click()
  await expect.element(dialog.getByRole('switch')).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await rerender(<TextToSpeech disabled />)
  await expect.element(toggle).toBeDisabled()
  await screen.getByText('Text to Speech', { exact: true }).hover()
  await expect.element(screen.getByRole('button', { name: 'Voice Settings' })).toBeDisabled()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
