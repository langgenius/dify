import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { FollowUpSettingsDialog } from '../follow-up-setting-modal'

const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4o-mini',
          label: { en_US: 'GPT-4o mini' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4o-mini' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    {
      initialData: {
        data: [
          {
            name: 'temperature',
            label: { en_US: 'Temperature' },
            type: 'float',
            default: 0.7,
            min: 0,
            max: 2,
          },
          {
            name: 'max_tokens',
            label: { en_US: 'Max Tokens' },
            type: 'int',
            default: 256,
            min: 0,
            max: 4096,
          },
        ],
      },
    },
  )
  return renderWithConsoleQuery(ui, { queryClient })
})

const renderModal = async (
  user: ReturnType<typeof userEvent.setup>,
  data: SuggestedQuestionsAfterAnswer = { enabled: true },
) => {
  const onSave = vi.fn()

  const view = render(<FollowUpSettingsDialog data={data} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.settings' }))

  return {
    onSave,
    ...view,
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
      const { onSave, rerender } = await renderModal(user, {
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

      await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
      const maxTokensSwitch = screen.getByRole('switch', { name: 'Max Tokens' })
      await user.click(maxTokensSwitch)

      expect(maxTokensSwitch).toHaveAttribute('aria-checked', 'false')
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(onSave.mock.lastCall![0].model.completion_params).not.toHaveProperty('max_tokens')
      expect(onSave.mock.lastCall![0].model.completion_params.temperature).toBe(0.7)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      rerender(<FollowUpSettingsDialog data={onSave.mock.lastCall![0]} onSave={onSave} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.settings' }))
      await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
      expect(screen.getByRole('switch', { name: 'Max Tokens' })).not.toBeChecked()
    })

    it('should keep max tokens disabled when saved model parameters omit it', async () => {
      const user = userEvent.setup()
      await renderModal(user, {
        enabled: true,
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: {
            temperature: 0.7,
          },
        },
      })

      await user.click(screen.getByRole('button', { name: /modelProvider.modelSettings/ }))
      expect(screen.getByRole('switch', { name: 'Max Tokens' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })
  })

  describe('Default Prompt', () => {
    it('should show the system default prompt and save without a custom prompt when no custom prompt is configured', async () => {
      const user = userEvent.setup()
      const { onSave } = await renderModal(user)

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
    it('should enable custom prompt input and save the custom prompt when selected', async () => {
      const user = userEvent.setup()
      const { onSave } = await renderModal(user)

      const custom = screen.getByRole('radio', { name: /modal.customPromptOption/ })
      expect(custom).toHaveAttribute('aria-checked', 'false')
      await user.click(custom)
      expect(custom).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()

      const textarea = screen.getByPlaceholderText(
        'appDebug.feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder',
      )

      await user.type(textarea, 'Use a custom follow-up prompt.')

      await user.click(screen.getByText(/common\.operation\.save/))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Use a custom follow-up prompt.',
        }),
      )
    })
  })
})
