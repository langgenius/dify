import type { AgentSoulModelConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import {
  api,
  applyButton,
  cleanupConfigureTest,
  complete,
  createBuildDraft,
  createComposer,
  createEnvironment,
  createSoul,
  prefix,
  promptEditor,
  receive,
  send,
  setupConfigureTest,
  ssePost,
} from './configure-test-env'

const buildModelsStorageKey = 'agent-v2-build-models'
const agentModel = { model_provider: 'openai', model: 'gpt-4', plugin_id: 'openai' }
const buildModel: AgentSoulModelConfig = {
  plugin_id: 'langgenius/anthropic',
  model_provider: 'langgenius/anthropic/anthropic',
  model: 'claude-sonnet-4-5',
  model_settings: { temperature: 0.2 },
}
const otherAgentBuildModel: AgentSoulModelConfig = {
  plugin_id: 'langgenius/openai',
  model_provider: 'langgenius/openai/openai',
  model: 'gpt-5.5',
}

const storeBuildModels = (models: Record<string, unknown>) =>
  localStorage.setItem(buildModelsStorageKey, JSON.stringify(models))
const storedBuildModels = (): unknown =>
  JSON.parse(localStorage.getItem(buildModelsStorageKey) ?? '{}')

const buildModelField = () => screen.findByRole('group', { name: `${prefix}.build.model.label` })

const chatBody = (index = 0) => {
  const body = ssePost.mock.calls[index]?.[1].body
  if (!body || typeof body !== 'object') throw new Error('Expected a chat request body')
  return body
}

const temperatureRules = {
  data: [
    {
      name: 'temperature',
      label: { en_US: 'Temperature' },
      type: 'float',
      default: 0.7,
      min: 0,
      max: 2,
    },
  ],
}

function seedBuildModels(queryClient: QueryClient, { withTemperature = false } = {}) {
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture(),
    createModelCatalogFixture({
      provider: 'langgenius/anthropic/anthropic',
      label: { en_US: 'Anthropic' },
      models: [
        createCatalogModelFixture({
          model: 'claude-sonnet-4-5',
          label: { en_US: 'Claude Sonnet 4.5' },
        }),
      ],
    }),
  ])
  if (withTemperature) {
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      { initialData: temperatureRules },
    )
  }
}

function renderBuildChat(search = '', options?: { withTemperature?: boolean }) {
  const env = createEnvironment({ buildDraft: createBuildDraft() })
  seedBuildModels(env.queryClient, options)
  return env.render(search)
}

async function changeBuildModelTemperature(
  user: ReturnType<typeof userEvent.setup>,
  temperature: string,
) {
  await user.click(
    within(await buildModelField()).getByRole('button', {
      name: 'modelProvider.modelProvider.modelSettings',
    }),
  )
  const settings = await screen.findByRole('dialog', {
    name: 'modelProvider.modelProvider.modelSettings',
  })
  const input = within(settings).getByRole('spinbutton', { name: 'Temperature' })
  await user.clear(input)
  await user.type(input, temperature)
  await user.click(within(settings).getByRole('button', { name: 'common.operation.close' }))
}

beforeEach(setupConfigureTest)
afterEach(cleanupConfigureTest)

describe('Build model', () => {
  it('follows the agent model by default, so build chat and finalization send no override', async () => {
    const user = userEvent.setup()
    renderBuildChat()
    const field = await buildModelField()
    expect(within(field).getByText(`${prefix}.build.model.followsAgent`)).toBeVisible()
    expect(
      within(field).queryByRole('button', { name: `${prefix}.build.model.useAgentModel` }),
    ).not.toBeInTheDocument()

    await send(user)
    await receive()

    expect(chatBody()).toMatchObject({ draft_type: 'debug_build' })
    expect(chatBody()).not.toHaveProperty('build_model')
  })

  it('sends the build model saved for this agent with each build chat turn', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': buildModel, 'agent-2': otherAgentBuildModel })
    renderBuildChat()
    const field = await buildModelField()
    expect(within(field).getByText(`${prefix}.build.model.buildOnly`)).toBeVisible()

    await send(user)
    await receive()

    expect(chatBody()).toMatchObject({ draft_type: 'debug_build', build_model: buildModel })
  })

  it('finalizes on the saved build model while apply keeps the build draft request unchanged', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': buildModel, 'agent-2': otherAgentBuildModel })
    renderBuildChat()
    await buildModelField()

    await user.click(applyButton())

    await waitFor(() =>
      expect(api.finalize).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
        body: { build_model: buildModel },
      }),
    )
    await waitFor(() =>
      expect(api.apply).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } }),
    )
  })

  it('finalizes without an override when the agent model is followed', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-2': otherAgentBuildModel })
    renderBuildChat()
    await buildModelField()

    await user.click(applyButton())

    await waitFor(() =>
      expect(api.finalize).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
        body: {},
      }),
    )
  })

  it('picks a build model for this agent only and can return to the agent model', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-2': otherAgentBuildModel })
    renderBuildChat()
    const field = await buildModelField()

    await user.click(within(field).getByRole('button', { name: /GPT-4/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^Claude Sonnet 4\.5/ }),
    )

    const selectedBuildModel = {
      plugin_id: 'langgenius/anthropic',
      model_provider: 'langgenius/anthropic/anthropic',
      model: 'claude-sonnet-4-5',
    }
    await waitFor(() =>
      expect(storedBuildModels()).toEqual({
        'agent-1': selectedBuildModel,
        'agent-2': otherAgentBuildModel,
      }),
    )
    expect(within(field).getByText(`${prefix}.build.model.buildOnly`)).toBeVisible()

    await send(user)
    await receive()
    expect(chatBody()).toMatchObject({ build_model: selectedBuildModel })
    await complete()

    await user.click(
      within(field).getByRole('button', { name: `${prefix}.build.model.useAgentModel` }),
    )

    expect(storedBuildModels()).toEqual({ 'agent-2': otherAgentBuildModel })
    expect(within(field).getByText(`${prefix}.build.model.followsAgent`)).toBeVisible()
    await send(user, 'build', 'Follow-up request')
    await receive(1, 'new-build', 'Second answer')
    expect(chatBody(1)).not.toHaveProperty('build_model')
  }, 10000)

  it('sends edited parameters of the chosen build model with the next build chat turn', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': buildModel, 'agent-2': otherAgentBuildModel })
    renderBuildChat('', { withTemperature: true })

    await changeBuildModelTemperature(user, '0.9')

    const editedBuildModel = { ...buildModel, model_settings: { temperature: 0.9 } }
    await waitFor(() =>
      expect(storedBuildModels()).toEqual({
        'agent-1': editedBuildModel,
        'agent-2': otherAgentBuildModel,
      }),
    )

    await send(user)
    await receive()

    expect(chatBody()).toMatchObject({ draft_type: 'debug_build', build_model: editedBuildModel })
  })

  it('turns a parameter edit on the followed agent model into a build model, leaving the agent config unchanged', async () => {
    const user = userEvent.setup()
    const followedAgentModel: AgentSoulModelConfig = {
      plugin_id: 'langgenius/anthropic',
      model_provider: 'langgenius/anthropic/anthropic',
      model: 'claude-sonnet-4-5',
      model_settings: { temperature: 0.7 },
    }
    storeBuildModels({ 'agent-2': otherAgentBuildModel })
    const env = createEnvironment({
      composer: createComposer(createSoul('Draft instructions', { model: followedAgentModel })),
      conversationId: null,
    })
    seedBuildModels(env.queryClient, { withTemperature: true })
    env.render()
    const field = await buildModelField()
    expect(within(field).getByText(`${prefix}.build.model.followsAgent`)).toBeVisible()

    await changeBuildModelTemperature(user, '0.9')

    const derivedBuildModel = { ...followedAgentModel, model_settings: { temperature: 0.9 } }
    await waitFor(() =>
      expect(storedBuildModels()).toEqual({
        'agent-1': derivedBuildModel,
        'agent-2': otherAgentBuildModel,
      }),
    )
    expect(within(field).getByText(`${prefix}.build.model.buildOnly`)).toBeVisible()

    await replacePromptEditorText(promptEditor(), 'Edited instructions')
    await send(user)
    await receive()

    expect(api.saveComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({ model: followedAgentModel }),
        }),
      }),
    )
    expect(chatBody()).toMatchObject({ draft_type: 'debug_build', build_model: derivedBuildModel })
  })

  it('keeps the agent model in the saved agent config while building on another model', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': buildModel })
    createEnvironment({ conversationId: null }).render()
    await buildModelField()
    await replacePromptEditorText(promptEditor(), 'Edited instructions')

    await send(user)
    await receive()

    expect(api.saveComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({ model: agentModel }),
        }),
      }),
    )
    expect(api.checkout).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      body: { force: false },
    })
    expect(chatBody()).toMatchObject({ build_model: buildModel })
  })

  it('never sends the build model from Preview', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': buildModel })
    renderBuildChat('?mode=preview')

    await send(user, 'preview')
    await receive()

    expect(
      screen.queryByRole('group', { name: `${prefix}.build.model.label` }),
    ).not.toBeInTheDocument()
    expect(chatBody()).not.toHaveProperty('build_model')
    expect(chatBody()).not.toHaveProperty('draft_type')
  })

  it('follows the agent model when the saved build model cannot be read', async () => {
    const user = userEvent.setup()
    storeBuildModels({ 'agent-1': { model: 'claude-sonnet-4-5' } })
    renderBuildChat()
    const field = await buildModelField()
    expect(within(field).getByText(`${prefix}.build.model.followsAgent`)).toBeVisible()

    await send(user)
    await receive()

    expect(chatBody()).not.toHaveProperty('build_model')
  })
})
