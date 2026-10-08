import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FollowUpSettingsDialog } from '../follow-up-setting-modal'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: {
      provider: {
        provider: 'openai',
      },
      model: 'gpt-4o-mini',
    },
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({
      provider,
      modelId,
      completionParams,
      onCompletionParamsChange,
    }: {
      provider: string
      modelId: string
      completionParams: FormValue
      onCompletionParamsChange: (newParams: FormValue) => void
    }) => {
      const hasMaxTokens = 'max_tokens' in completionParams

      return (
        <div data-testid="model-parameter-modal">
          {`${provider}:${modelId}`}
          <button
            type="button"
            role="switch"
            aria-checked={hasMaxTokens}
            onClick={() => {
              const { max_tokens: _maxTokens, ...remainingParams } = completionParams
              onCompletionParamsChange(remainingParams)
            }}
          >
            Max Tokens
          </button>
        </div>
      )
    },
  }),
)

const renderModal = async (data: SuggestedQuestionsAfterAnswer = { enabled: true }) => {
  const onSave = vi.fn()

  render(<FollowUpSettingsDialog data={data} onSave={onSave} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.settings' }))

  return {
    onSave,
  }
}

describe('FollowUpSettingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers optional model parameters staying disabled across edits and subsequent opens.
  describe('Model Parameters', () => {
    it('should keep max tokens disabled after its switch is turned off', async () => {
      const user = userEvent.setup()
      await renderModal({
        enabled: true,
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: {
            temperature: 0.7,
            max_tokens: 0,
            top_p: 0,
            echo: false,
            stop: [],
            presence_penalty: 0,
            frequency_penalty: 0,
          },
        },
      })

      const maxTokensSwitch = screen.getByRole('switch', { name: 'Max Tokens' })
      await user.click(maxTokensSwitch)

      expect(maxTokensSwitch).toHaveAttribute('aria-checked', 'false')
    })

    it('should keep max tokens disabled when saved model parameters omit it', async () => {
      await renderModal({
        enabled: true,
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: {
            temperature: 0.7,
          } as CompletionParams,
        },
      })

      expect(screen.getByRole('switch', { name: 'Max Tokens' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })
  })

  describe('Default Prompt', () => {
    it('should show the system default prompt and save without a custom prompt when no custom prompt is configured', async () => {
      const user = userEvent.setup()
      const { onSave } = await renderModal()

      expect(
        screen.getByText(
          'appDebug.feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOption',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          /Please predict the three most likely follow-up questions a user would ask/,
        ),
      ).toBeInTheDocument()

      await user.click(screen.getByText(/common\.operation\.save/))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: undefined,
          model: expect.objectContaining({
            provider: 'openai',
            name: 'gpt-4o-mini',
          }),
        }),
      )
    })
  })

  describe('Custom Prompt', () => {
    it('should expose the selected prompt mode to assistive technology', async () => {
      const user = userEvent.setup()
      await renderModal()

      const defaultOption = screen.getByRole('radio', { name: /modal.defaultPromptOption/ })
      const customOption = screen.getByRole('radio', { name: /modal.customPromptOption/ })

      expect(defaultOption).toHaveAttribute('aria-checked', 'true')
      expect(customOption).toHaveAttribute('aria-checked', 'false')

      await user.click(customOption)

      expect(defaultOption).toHaveAttribute('aria-checked', 'false')
      expect(customOption).toHaveAttribute('aria-checked', 'true')
    })

    it('should enable custom prompt input and save the custom prompt when selected', async () => {
      const user = userEvent.setup()
      const { onSave } = await renderModal()

      await user.click(screen.getByRole('radio', { name: /modal.customPromptOption/ }))

      const textarea = screen.getByPlaceholderText(
        'appDebug.feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder',
      )
      expect(textarea).toHaveAttribute('maxLength', '1000')

      await user.type(textarea, 'Use a custom follow-up prompt.')

      await user.click(screen.getByText(/common\.operation\.save/))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Use a custom follow-up prompt.',
        }),
      )
    })

    it('should disable save when custom prompt is selected but empty', async () => {
      const user = userEvent.setup()
      await renderModal()

      await user.click(screen.getByRole('radio', { name: /modal.customPromptOption/ }))

      expect(screen.getByText(/common\.operation\.save/).closest('button')).toBeDisabled()
    })
  })
})
