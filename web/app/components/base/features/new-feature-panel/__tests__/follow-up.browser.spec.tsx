import { Button } from '@langgenius/dify-ui/button'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FeaturesProvider } from '../../context'
import { FollowUp } from '../follow-up'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({ defaultModel: undefined }),
}))
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <div>Model selector</div>,
  }),
)

describe('Follow-up settings keyboard access', () => {
  it('reveals the persistent trigger with keyboard focus and restores visible focus after closing', async () => {
    // Native focus and CSS visibility prove the card remains usable without hovering it.
    const screen = await render(
      <FeaturesProvider features={{ suggested: { enabled: true } }}>
        <Button>Before feature</Button>
        <FollowUp />
      </FeaturesProvider>,
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
