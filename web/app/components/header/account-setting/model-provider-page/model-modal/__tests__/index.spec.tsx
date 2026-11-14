import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCredentialProvider,
  customModel,
  renderCredentialComponent,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, FormTypeEnum, ModelModalModeEnum } from '../../declarations'
import ModelModal from '../index'

const requests = vi.hoisted(() => ({ provider: vi.fn(), model: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.credentials.post': requests.provider,
      'workspaces.current.modelProviders.byProvider.models.credentials.post': requests.model,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': () => ({
        credentials: {},
        available_credentials: [],
      }),
    }),
  }
})
beforeEach(() => {
  requests.provider.mockResolvedValue({ result: 'success' })
  requests.model.mockResolvedValue({ result: 'success' })
})
function renderModal(overrides: Partial<ComponentProps<typeof ModelModal>> = {}) {
  const onSave = vi.fn()
  renderCredentialComponent(
    <ModelModal
      provider={createCredentialProvider()}
      configurateMethod={ConfigurationMethodEnum.predefinedModel}
      onCancel={() => {}}
      onSave={onSave}
      onRemove={() => {}}
      {...overrides}
    />,
  )
  return onSave
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByRole('textbox', { name: /authorizationName/ }),
    'My credential',
  )
  await user.type(screen.getByLabelText(/API key/), 'secret')
}
it('blocks invalid credentials then saves the entered values through the real auth owner', async () => {
  const user = userEvent.setup()
  const onSave = renderModal()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(requests.provider).not.toHaveBeenCalled()
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(requests.provider).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'openai' },
      body: { credential_id: undefined, credentials: { api_key: 'secret' }, name: 'My credential' },
    }),
  )
  expect(onSave).toHaveBeenCalledWith({
    __authorization_name__: 'My credential',
    api_key: 'secret',
  })
})
it.each(['model', 'fixed'] as const)(
  'saves a credential using the %s model context',
  async (context) => {
    const user = userEvent.setup()
    renderModal({
      isModelCredential: true,
      mode: ModelModalModeEnum.configModelCredential,
      ...(context === 'model'
        ? { model: customModel }
        : {
            currentCustomConfigurationModelFixedFields: {
              __model_name: customModel.model,
              __model_type: customModel.model_type,
            },
          }),
    })
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(requests.model).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'openai' },
        body: {
          credential_id: undefined,
          credentials: {
            api_key: 'secret',
            ...(context === 'model' ? { __model_name: 'gpt-4', __model_type: 'llm' } : {}),
          },
          name: 'My credential',
          ...customModel,
        },
      }),
    )
    expect(requests.provider).not.toHaveBeenCalled()
  },
)
it('does not save a model credential without model context', async () => {
  const user = userEvent.setup()
  renderModal({ isModelCredential: true, mode: ModelModalModeEnum.configModelCredential })
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(requests.model).not.toHaveBeenCalled()
  expect(requests.provider).not.toHaveBeenCalled()
})
it('validates the model name as well as credentials before adding a custom model', async () => {
  const user = userEvent.setup()
  renderModal({
    isModelCredential: true,
    mode: ModelModalModeEnum.configCustomModel,
    configurateMethod: ConfigurationMethodEnum.customizableModel,
  })
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(requests.model).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Model/ }), 'custom-model')
  await user.click(screen.getByRole('combobox', { name: 'Model Type' }))
  await user.click(screen.getByRole('option', { name: 'LLM' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await waitFor(() =>
    expect(requests.model).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: expect.objectContaining({
        model: 'custom-model',
        model_type: 'llm',
        credentials: { api_key: 'secret', __model_name: 'custom-model', __model_type: 'llm' },
        name: 'My credential',
      }),
    }),
  )
})
it.each(['openai', 'langgenius/openai/openai', 'langgenius/azure_openai/azure_openai'])(
  'limits Responses API guidance to official OpenAI providers: %s',
  (provider) => {
    renderModal({
      provider: createCredentialProvider({
        provider,
        provider_credential_schema: {
          credential_form_schemas: [
            {
              name: 'api_protocol',
              variable: 'api_protocol',
              label: { en_US: 'Protocol', zh_Hans: 'Protocol' },
              type: FormTypeEnum.select,
              required: false,
              show_on: [],
              options: [],
            },
          ],
        },
      }),
    })
    const tip = screen.queryByText('modelProvider.modelProvider.auth.openAIResponsesAPITip')
    if (provider.includes('azure_openai')) expect(tip).not.toBeInTheDocument()
    else expect(tip).toBeInTheDocument()
  },
)
