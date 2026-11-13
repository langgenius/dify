import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { FollowUp } from '../follow-up'
import { renderFeature } from './feature-browser-test-env'
import { followUpQueryClient } from './follow-up-preset'

vi.unmock('react-i18next')
beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('enables configuration through the real feature store and blocks readonly editing', async () => {
  const { screen, store, rerender } = await renderFeature(
    <FollowUp />,
    { suggested: { enabled: false } },
    { queryClient: followUpQueryClient() },
  )
  await expect
    .element(screen.getByRole('button', { name: 'Settings', exact: true }))
    .not.toBeInTheDocument()
  await screen.getByRole('switch').click()
  await expect.element(screen.getByRole('switch')).toBeChecked()
  expect(store.getState().features.suggested?.enabled).toBe(true)
  await userEvent.unhover(document.body)
  await userEvent.keyboard('{Tab}')
  const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
  await expect.element(trigger).toHaveFocus()
  expect(Number(getComputedStyle(trigger.element()).opacity)).toBeGreaterThan(0)
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Custom prompt/ }).click()
  const prompt = dialog.getByRole('textbox', { name: 'Custom prompt', exact: true })
  await prompt.fill('Next question')
  await userEvent.keyboard('{ArrowLeft}{ArrowUp}')
  await expect.element(prompt).toHaveFocus()
  await expect.element(dialog.getByRole('radio', { name: /Custom prompt/ })).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog.getByRole('radio', { name: /System default prompt/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await rerender(<FollowUp disabled />)
  await expect.element(screen.getByRole('switch')).toBeDisabled()
  await expect.element(trigger).toBeDisabled()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('discards cancelled prompt edits and reopens the committed custom prompt', async () => {
  const { screen, store } = await renderFeature(
    <FollowUp />,
    { suggested: { enabled: true, prompt: 'Saved prompt' } },
    { queryClient: followUpQueryClient() },
  )
  await screen.getByRole('switch').hover()
  const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
  await trigger.click()
  await screen.getByRole('textbox', { name: 'Custom prompt', exact: true }).fill('Discard me')
  await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(store.getState().features.suggested?.prompt).toBe('Saved prompt')
  await userEvent.keyboard('{Enter}')
  const prompt = screen.getByRole('textbox', { name: 'Custom prompt', exact: true })
  await expect.element(prompt).toHaveValue('Saved prompt')
  await prompt.fill('New prompt')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(store.getState().features.suggested?.prompt).toBe('New prompt')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('textbox', { name: 'Custom prompt', exact: true }))
    .toHaveValue('New prompt')
})

it('saves the default model and requires content before accepting a custom prompt', async () => {
  const { screen, store } = await renderFeature(
    <FollowUp />,
    { suggested: { enabled: true } },
    { queryClient: followUpQueryClient() },
  )
  await screen.getByRole('switch').hover()
  const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
  await trigger.click()
  await expect
    .element(screen.getByText(/Please predict the three most likely follow-up questions/))
    .toBeVisible()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(store.getState().features.suggested).toMatchObject({
    prompt: undefined,
    model: { provider: 'openai', name: 'gpt-4o-mini' },
  })
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await screen.getByRole('radio', { name: /Custom prompt/ }).click()
  await expect.element(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await screen.getByPlaceholder('Enter a custom prompt').fill('Use a custom follow-up prompt.')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(store.getState().features.suggested?.prompt).toBe('Use a custom follow-up prompt.')
})
