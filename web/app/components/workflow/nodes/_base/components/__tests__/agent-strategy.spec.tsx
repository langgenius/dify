import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createProvider, createStrategy } from '../../../agent/__tests__/strategy-fixture'
import { AgentStrategy } from '../agent-strategy'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({ request }))
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useDefaultModel: () => ({ data: null }),
  }),
)
vi.mock('@/app/components/workflow/hooks/use-workflow-variables', () => ({
  useWorkflowVariableType: () => vi.fn(),
}))
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: () => ({ queryPluginsWithDebounced: vi.fn(), plugins: [] }),
}))
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: () => ({
    isLoading: false,
    data: { data: { plugins: [] } },
    refetch: vi.fn(),
  }),
}))

const strategy = {
  agent_strategy_provider_name: 'langgenius/agent/provider',
  agent_strategy_name: 'react',
  agent_strategy_label: 'ReAct',
  agent_output_schema: null,
}
const createParameter = (overrides: Partial<AgentStrategyParameter>): AgentStrategyParameter => ({
  name: 'count',
  type: 'number',
  label: { en_US: 'Count' },
  default: '3',
  min: 0,
  max: 10,
  ...overrides,
})
const renderForm = (
  parameters: AgentStrategyParameter[],
  initialValue: Record<string, unknown> = {},
) => {
  const onChange = vi.fn()
  request.mockImplementation((url: string) =>
    Promise.resolve(
      Response.json(
        url.endsWith('/agent-providers')
          ? [createProvider()]
          : createProvider([createStrategy({ parameters })]),
      ),
    ),
  )
  const workflowStore = createWorkflowStore({})
  function Harness() {
    const [value, setValue] = useState(initialValue)
    return (
      <WorkflowContext value={workflowStore}>
        <AgentStrategy
          strategy={strategy}
          onStrategyChange={vi.fn()}
          formSchema={parameters}
          formValue={value}
          onFormValueChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      </WorkflowContext>
    )
  }
  const result = render(<Harness />, { systemFeatures: { enable_marketplace: false } })
  return { ...result, onChange }
}

beforeEach(() => vi.clearAllMocks())

it('renders typed number and boolean defaults through the real form without requiring an installation identifier', async () => {
  const user = userEvent.setup()
  const { onChange } = renderForm([
    createParameter({ default: 0 }),
    createParameter({
      name: 'enabled',
      type: 'boolean',
      label: { en_US: 'Enabled' },
      default: false,
    }),
  ])
  expect(screen.getByRole('textbox', { name: 'Count' })).toHaveValue('0')
  expect(screen.getByRole('radio', { name: 'False' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'True' }))
  expect(onChange).toHaveBeenLastCalledWith({ count: 0, enabled: true })
})

it.each([
  { value: undefined, expected: '3' },
  { value: '4', expected: '4' },
  { value: 0, expected: '0' },
])('preserves numeric strings and zero: $value', ({ value, expected }) => {
  renderForm([createParameter({})], value === undefined ? {} : { count: value })
  expect(screen.getByRole('textbox', { name: 'Count' })).toHaveValue(expected)
})

it('preserves a one-sided numeric constraint through fallback input and blur', async () => {
  const user = userEvent.setup()
  const { onChange } = renderForm([createParameter({ min: 0, max: null })])
  const input = screen.getByRole('spinbutton')
  await user.clear(input)
  await user.type(input, '-2')
  await user.tab()
  expect(input).toHaveValue(0)
  expect(onChange).toHaveBeenLastCalledWith({ count: '0' })
})

it('does not select a boolean value when the declaration default is null', () => {
  renderForm([
    createParameter({
      name: 'enabled',
      type: 'boolean',
      label: { en_US: 'Enabled' },
      default: null,
    }),
  ])
  expect(screen.getByRole('radio', { name: 'False' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: 'True' })).not.toBeChecked()
})

it.each(['', null])(
  'displays the declared default for a cleared prompt %s, matching runtime initialization',
  async (prompt) => {
    renderForm(
      [
        createParameter({
          name: 'prompt',
          type: 'string',
          label: { en_US: 'Prompt' },
          default: 'Default prompt',
        }),
      ],
      { prompt },
    )
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('Default prompt'))
  },
)

it('uses the declaration default for an explicitly undefined form value', async () => {
  renderForm(
    [
      createParameter({
        name: 'prompt',
        type: 'string',
        label: { en_US: 'Prompt' },
        default: 'Default prompt',
      }),
    ],
    { prompt: undefined },
  )
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('Default prompt'))
})
