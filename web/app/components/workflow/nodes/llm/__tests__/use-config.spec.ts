import type { EnvironmentVariable } from '../../../types'
import type { LLMNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import {
  ModelFeatureEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { BlockEnum, EditionType, PromptRole } from '../../../types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    currentProvider: { provider: 'openai' },
    currentModel: { model: 'text-model', model_properties: { mode: 'chat' } },
  }),
  useTextGenerationCurrentProviderAndModelAndModelList: ({ model }: { model: string }) => ({
    currentModel: { features: model === 'vision-model' ? [ModelFeatureEnum.vision] : [] },
  }),
}))

const prompt = { role: PromptRole.user, text: 'Default prompt', edition_type: EditionType.basic }
const defaults = {
  prompt_templates: {
    chat_model: { prompts: [prompt] },
    completion_model: {
      prompt,
      conversation_histories_role: { user_prefix: 'User', assistant_prefix: 'Assistant' },
    },
  },
}
const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'vision-model',
    mode: 'chat',
    completion_params: { temperature: 0.7 },
  },
  prompt_template: [prompt],
  context: { enabled: false, variable_selector: [] },
  vision: { enabled: true },
  ...overrides,
})
const sharedModel = {
  id: 'shared',
  name: 'shared',
  value_type: 'llm',
  description: '',
  value: {
    provider: 'shared-provider',
    name: 'shared-model',
    mode: 'completion',
    completion_params: { top_p: 0.9 },
  },
} satisfies EnvironmentVariable
const setup = (payload = createPayload(), environmentVariables: EnvironmentVariable[] = []) => {
  const { queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }),
    { data: [] },
  )
  return renderNodeConfig(useConfig, payload, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    initialStoreState: { environmentVariables, nodesDefaultConfigs: { [BlockEnum.LLM]: defaults } },
  })
}

it('keeps model and completion edits after real vision reconciliation', async () => {
  const { result } = setup()
  act(() =>
    result.current.config.handleModelChanged(
      { provider: 'openai', modelId: 'text-model', mode: 'chat' },
      { temperature: 0.3 },
    ),
  )
  await waitFor(() => expect(result.current.config.inputs.vision.enabled).toBe(false))
  act(() => result.current.config.handleCompletionParamsChange({ top_p: 0.5 }))
  expect(result.current.flow.getNode('node')?.data).toEqual(
    expect.objectContaining({
      model: {
        provider: 'openai',
        name: 'text-model',
        mode: 'chat',
        completion_params: { top_p: 0.5 },
      },
      vision: { enabled: false },
    }),
  )
})

it('hydrates an unconfigured model and real prompt defaults from the provider catalog', async () => {
  const { result } = setup(
    createPayload({ model: { provider: '', name: '', mode: 'completion', completion_params: {} } }),
  )
  await waitFor(() => expect(result.current.config.inputs.model.name).toBe('text-model'))
  expect(result.current.config.inputs.prompt_template).toEqual([prompt])
  expect(result.current.config.inputs.vision.enabled).toBe(false)
})

it('binds a shared environment model and applies completion prompt defaults', async () => {
  const { result } = setup(createPayload(), [sharedModel])
  act(() => result.current.config.handleModelSelectorChange(['env', 'shared'], { max_tokens: 42 }))
  await waitFor(() => expect(result.current.config.inputs.vision.enabled).toBe(false))
  expect(result.current.config.model).toEqual(sharedModel.value)
  expect(result.current.config.inputs.prompt_template).toEqual(prompt)
  expect(result.current.flow.getNode('node')?.data.model_selector).toEqual(['env', 'shared'])
})

it('resolves updated shared metadata and preserves its latest identity when returning to direct input', () => {
  const chatModel = { ...sharedModel, value: { ...sharedModel.value, mode: 'chat' as const } }
  const { result, store } = setup(createPayload({ model_selector: ['env', 'shared'] }), [chatModel])
  expect(result.current.config.model).toEqual(chatModel.value)
  const latest = {
    provider: 'latest-provider',
    name: 'latest-model',
    mode: 'chat' as const,
    completion_params: { temperature: 0.8 },
  }
  act(() => store.setState({ environmentVariables: [{ ...sharedModel, value: latest }] }))
  expect(result.current.config.model).toEqual(latest)
  act(() => result.current.config.handleModelSourceChange(false))
  expect(result.current.flow.getNode('node')?.data).toEqual(
    expect.objectContaining({ model: latest, model_selector: undefined }),
  )
})
