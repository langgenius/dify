import type { ComponentProps } from 'react'
import type { consoleClient } from '@/service/console'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createTrialAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import AppInfo from '../index'

const getWorkflow = vi.hoisted(() => vi.fn<typeof consoleClient.trialApps.byAppId.workflows.get>())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'trialApps.byAppId.workflows.get': getWorkflow,
    }),
  }
})

beforeEach(() => {
  getWorkflow.mockReset().mockResolvedValue(createWorkflowResponseFixture())
})

function setup(overrides: Partial<ComponentProps<typeof AppInfo>> = {}) {
  return render(
    <AppInfo
      appId="template-id"
      appDetail={createTrialAppDetailFixture()}
      onCreate={vi.fn()}
      {...overrides}
    />,
  )
}
const requirements = () => screen.getByRole('region', { name: 'explore.tryApp.requirements' })
const requirementNames = () =>
  within(requirements())
    .getAllByRole('listitem')
    .map((item) => item.textContent)

it.each([
  ['advanced-chat', 'ADVANCED'],
  ['chat', 'CHATBOT'],
  ['agent-chat', 'AGENT'],
  ['workflow', 'WORKFLOW'],
  ['completion', 'COMPLETION'],
] as const)('identifies %s templates as %s', (mode, label) => {
  setup({ appDetail: createTrialAppDetailFixture({ mode }) })
  expect(screen.getByText(`APP.TYPES.${label}`)).toBeInTheDocument()
})

it.each([
  ['chat', 'langgenius/google/google', 'google', 'langgenius/gemini'],
  ['completion', 'anthropic/claude/claude', 'claude', 'anthropic/claude'],
] as const)(
  'shows the %s provider and its marketplace icon without requesting a workflow',
  (mode, provider, name, plugin) => {
    setup({
      appDetail: createTrialAppDetailFixture({
        mode,
        model_config: {
          ...createTrialAppDetailFixture().model_config,
          model: { provider, name: 'model-1', mode: 'chat' },
        },
      }),
    })
    expect(requirementNames()).toEqual([name])
    // Provider icons are decorative; their external asset URL is the integration contract.
    expect(requirements().querySelector('img')).toHaveAttribute(
      'src',
      `${MARKETPLACE_API_PREFIX}/plugins/${plugin}/icon`,
    )
    expect(getWorkflow).not.toHaveBeenCalled()
  },
)

it('lists the agent model and enabled tools, using the builtin tool icon alias', () => {
  const tool = {
    enabled: true,
    provider_id: 'langgenius/jina/jina',
    provider_type: 'builtin',
    provider_name: 'jina',
    tool_name: 'jina_search',
    tool_parameters: {},
    tool_label: 'Jina Search',
  }
  setup({
    appDetail: createTrialAppDetailFixture({
      mode: 'agent-chat',
      model_config: {
        ...createTrialAppDetailFixture().model_config,
        model: { provider: 'langgenius/openai/openai', name: 'gpt-4', mode: 'chat' },
        agent_mode: {
          enabled: true,
          tools: [
            tool,
            { ...tool, tool_name: 'jina_reader', enabled: false, tool_label: 'Jina Reader' },
          ],
        },
      },
    }),
  })
  expect(requirementNames()).toEqual(['openai', 'Jina Search'])
  expect(
    requirements().querySelector('img[src$="/plugins/langgenius/jina_tool/icon"]'),
  ).toBeInTheDocument()
})

it('shows deduplicated model and tool requirements after the requested workflow loads', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof getWorkflow>>>()
  getWorkflow.mockReturnValue(request.promise)
  setup({ appDetail: createTrialAppDetailFixture({ mode: 'workflow' }) })
  expect(
    screen.queryByRole('region', { name: 'explore.tryApp.requirements' }),
  ).not.toBeInTheDocument()
  const model = {
    type: BlockEnum.LLM,
    model: { name: 'GPT-4', provider: 'langgenius/openai/openai' },
  }
  await act(async () =>
    request.resolve(
      createWorkflowResponseFixture({
        graph: {
          nodes: [
            { id: 'llm-1', data: model },
            { id: 'llm-2', data: model },
            {
              id: 'llm-3',
              data: {
                type: BlockEnum.LLM,
                model: { name: 'Claude', provider: 'anthropic/claude/claude' },
              },
            },
            {
              id: 'tool-1',
              data: {
                type: BlockEnum.Tool,
                provider_id: 'langgenius/google/google',
                tool_label: 'Google Search',
              },
            },
            {
              id: 'tool-2',
              data: {
                type: BlockEnum.Tool,
                provider_id: 'langgenius/jina/jina',
                tool_label: 'Jina Search',
              },
            },
          ],
          edges: [],
        },
      }),
    ),
  )
  await screen.findByRole('region', { name: 'explore.tryApp.requirements' })
  expect(requirementNames()).toEqual(['GPT-4', 'Claude', 'Google Search', 'Jina Search'])
  expect(getWorkflow).toHaveBeenCalledWith({ params: { app_id: 'template-id' } })
})

it.each(['chat', 'workflow'] as const)(
  'omits requirements and categories for a %s template without any',
  async (mode) => {
    await act(async () =>
      setup({ appDetail: createTrialAppDetailFixture({ mode, model_config: null }) }),
    )
    expect(
      screen.queryByRole('region', { name: 'explore.tryApp.requirements' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'explore.tryApp.category' }),
    ).not.toBeInTheDocument()
  },
)

it('keeps the requirement visible when its provider icon fails to load', () => {
  setup()
  const icon = requirements().querySelector('img')!
  expect(icon).toHaveAttribute('src', `${MARKETPLACE_API_PREFIX}/plugins/langgenius/openai/icon`)
  fireEvent.error(icon)
  expect(icon).not.toBeInTheDocument()
  expect(requirementNames()).toEqual(['openai'])
})
