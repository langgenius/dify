import type { QuestionClassifierNodeType } from '../types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { act, waitFor } from '@testing-library/react'
import { useNodes, useReactFlow } from 'reactflow'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import useConfig from '../use-config'

// Model capabilities are external catalog data; node updates and vision reconciliation stay real.
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({}),
  useTextGenerationCurrentProviderAndModelAndModelList: ({ model }: { model: string }) => ({
    currentModel: { features: model === 'vision-model' ? [ModelFeatureEnum.vision] : [] },
  }),
}))

const createPayload = (
  overrides: Partial<QuestionClassifierNodeType> = {},
): QuestionClassifierNodeType => ({
  type: BlockEnum.QuestionClassifier,
  title: 'Question Classifier',
  desc: '',
  model: { provider: 'openai', name: 'vision-model', mode: 'chat', completion_params: {} },
  classes: [{ id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }],
  _targetBranches: [{ id: 'topic-1', name: 'Billing questions' }],
  query_variable_selector: ['start', 'query'],
  instruction: 'Route by topic',
  vision: { enabled: true },
  ...overrides,
})

const setup = (
  payload = createPayload(),
  resource: EditorResource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowHook(
    () => {
      const nodes = useNodes<QuestionClassifierNodeType>()
      return {
        config: useConfig(
          'classifier',
          nodes.find((node) => node.id === 'classifier')?.data ?? payload,
        ),
        flow: useReactFlow(),
      }
    },
    {
      resource,
      queryClient,
      initialStoreState: {
        nodesDefaultConfigs: { [BlockEnum.QuestionClassifier]: createPayload() },
      },
      nodes: [
        createNode({ id: 'start', data: { type: BlockEnum.Start, variables: [] } }),
        createNode({ id: 'classifier', data: payload }),
      ],
      edges: [createEdge({ source: 'start', target: 'classifier' })],
    },
  )
}

it('keeps the selected model after real vision reconciliation disables unsupported vision', async () => {
  const { result } = setup()
  expect(result.current.config.inputs.vision.enabled).toBe(true)
  act(() =>
    result.current.config.handleModelChanged({
      provider: 'openai',
      modelId: 'text-model',
      mode: 'chat',
    }),
  )
  await waitFor(() => expect(result.current.config.inputs.vision.enabled).toBe(false))
  expect(result.current.flow.getNode('classifier')?.data.model).toEqual(
    expect.objectContaining({ provider: 'openai', name: 'text-model', mode: 'chat' }),
  )
})

it('persists consecutive model, completion and class edits without losing earlier changes', async () => {
  const { result } = setup()
  act(() =>
    result.current.config.handleModelChanged({
      provider: 'openai',
      modelId: 'text-model',
      mode: 'chat',
    }),
  )
  await waitFor(() => expect(result.current.config.inputs.vision.enabled).toBe(false))
  act(() => result.current.config.handleCompletionParamsChange({ temperature: 0.2 }))
  act(() =>
    result.current.config.handleTopicsChange([{ id: 'refund', name: 'Refunds', label: 'CLASS 1' }]),
  )
  expect(result.current.flow.getNode('classifier')?.data).toEqual(
    expect.objectContaining({
      model: expect.objectContaining({
        name: 'text-model',
        completion_params: { temperature: 0.2 },
      }),
      classes: [{ id: 'refund', name: 'Refunds', label: 'CLASS 1' }],
      _targetBranches: [{ id: 'refund', name: 'Refunds' }],
      vision: { enabled: false },
    }),
  )
})

it.each([
  { resource: { kind: 'snippet', snippetId: 'snippet-1' } as EditorResource, selector: [] },
  { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } as EditorResource, selector: [] },
  {
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' } as EditorResource,
    selector: ['start', 'sys.query'],
  },
])('derives the default query selector from $resource', async ({ resource, selector }) => {
  const { result } = setup(createPayload({ query_variable_selector: [] }), resource)
  await waitFor(() =>
    expect(result.current.config.inputs.query_variable_selector).toEqual(selector),
  )
})
