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

it('removes disabled max tokens from saved parameters and keeps it disabled after reopening', async () => {
  const { screen, store } = await renderFeature(
    <FollowUp />,
    {
      suggested: {
        enabled: true,
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: { temperature: 0.7, max_tokens: 0 },
        },
      },
    },
    { queryClient: followUpQueryClient() },
  )
  await screen.getByRole('switch').hover()
  const trigger = screen.getByRole('button', { name: 'Settings', exact: true })
  await trigger.click()
  await screen.getByRole('button', { name: /Model Settings/ }).click()
  const maxTokens = screen.getByRole('switch', { name: 'Max Tokens' })
  await expect.element(maxTokens).toBeChecked()
  await maxTokens.click()
  await expect.element(maxTokens).not.toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(maxTokens).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  const params = store.getState().features.suggested?.model?.completion_params
  expect(params).not.toHaveProperty('max_tokens')
  expect(params?.temperature).toBe(0.7)
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await screen.getByRole('button', { name: /Model Settings/ }).click()
  await expect.element(maxTokens).not.toBeChecked()
})
