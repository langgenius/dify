import { Button } from '@langgenius/dify-ui/button'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { FeaturesProvider } from '../../context'
import { FollowUp } from '../follow-up'

describe('Follow-up settings keyboard access', () => {
  it('reveals the persistent trigger with keyboard focus and restores visible focus after closing', async () => {
    // Native focus and CSS visibility prove the card remains usable without hovering it.
    const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
    seedModelProviderQueries(queryClient)
    const screen = await render(
      <NuqsTestingAdapter>
        <QueryProvider>
          <FeaturesProvider features={{ suggested: { enabled: true } }}>
            <Button>Before feature</Button>
            <FollowUp />
          </FeaturesProvider>
        </QueryProvider>
      </NuqsTestingAdapter>,
    )
    await screen.getByRole('button', { name: 'Before feature' }).click()
    await userEvent.tab()
    await expect.element(screen.getByRole('switch')).toHaveFocus()
    await userEvent.tab()
    const trigger = screen.getByRole('button', { name: 'common.operation.settings' })
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
    await userEvent.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /modal.customPromptOption/ }).click()
    const prompt = dialog.getByRole('textbox', { name: /modal.customPromptOption/ })
    await prompt.fill('Next question')
    await userEvent.keyboard('{ArrowLeft}{ArrowUp}')
    await expect.element(prompt).toHaveFocus()
    await expect
      .element(dialog.getByRole('radio', { name: /modal.customPromptOption/ }))
      .toBeChecked()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
    await userEvent.keyboard('{Enter}')
    await dialog.getByRole('button', { name: 'common.operation.save' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  })
})
