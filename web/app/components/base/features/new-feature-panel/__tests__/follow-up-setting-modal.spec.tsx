import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FollowUpSettingModal from '../follow-up-setting-modal'

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

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ provider, modelId }: { provider: string, modelId: string }) => (
    <div data-testid="model-parameter-modal">{`${provider}:${modelId}`}</div>
  ),
}))

const renderModal = (data: SuggestedQuestionsAfterAnswer = { enabled: true }) => {
  const onSave = vi.fn()
  const onCancel = vi.fn()

  render(
    <FollowUpSettingModal
      data={data}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )

  return {
    onSave,
    onCancel,
  }
}

describe('FollowUpSettingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Default Prompt', () => {
    it('should show the system default prompt and save without a custom prompt when no custom prompt is configured', async () => {
      const user = userEvent.setup()
      const { onSave } = renderModal()

      expect(screen.getByText('appDebug.feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOption')).toBeInTheDocument()
      expect(screen.getByText(/Please predict the three most likely follow-up questions a user would ask/)).toBeInTheDocument()

      await user.click(screen.getByText(/common\.operation\.save/))

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        prompt: undefined,
        model: expect.objectContaining({
          provider: 'openai',
          name: 'gpt-4o-mini',
        }),
      }))
    })
  })

  describe('Custom Prompt', () => {
    it('should enable custom prompt input and save the custom prompt when selected', async () => {
      const user = userEvent.setup()
      const { onSave } = renderModal()

      await user.click(screen.getByText('appDebug.feature.suggestedQuestionsAfterAnswer.modal.customPromptOption').closest('button')!)

      const textarea = screen.getByPlaceholderText('appDebug.feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder')
      expect(textarea).toHaveAttribute('maxLength', '1000')

      fireEvent.change(
        textarea,
        { target: { value: 'Use a custom follow-up prompt.' } },
      )

      await user.click(screen.getByText(/common\.operation\.save/))

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Use a custom follow-up prompt.',
      }))
    })

    it('should disable save when custom prompt is selected but empty', async () => {
      const user = userEvent.setup()
      renderModal()

      await user.click(screen.getByText('appDebug.feature.suggestedQuestionsAfterAnswer.modal.customPromptOption').closest('button')!)

      expect(screen.getByText(/common\.operation\.save/).closest('button')).toBeDisabled()
    })
  })
})
