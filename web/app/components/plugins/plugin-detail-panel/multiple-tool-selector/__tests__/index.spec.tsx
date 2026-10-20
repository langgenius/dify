import type { ComponentProps } from 'react'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import MultipleToolSelector from '../index'

const createToolValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'regular',
  tool_name: 'test-tool',
  tool_label: 'Test Tool',
  settings: {},
  parameters: {},
  enabled: true,
  extra: { description: 'Keep this configuration' },
  ...overrides,
})

const provider = (id: string, names: string[], type: 'builtin' | 'mcp' = 'builtin') =>
  createToolProviderFixture({
    id,
    name: id,
    type,
    label: { en_US: id },
    is_team_authorization: true,
    allow_delete: false,
    tools: names.map((name) => ({
      name,
      author: 'Dify',
      label: { en_US: name },
      description: { en_US: name },
      parameters: [],
    })),
  })

type Options = Partial<ComponentProps<typeof MultipleToolSelector>> & { versionSupported?: boolean }
const renderSelector = ({ value = [], versionSupported = true, ...options }: Options = {}) => {
  const queryClient = createConsoleQueryClient()
  seedToolProviders(queryClient, {
    builtInTools: [
      provider('new-provider', ['new-tool', 'second-tool']),
      provider('different-provider', ['new-tool']),
      provider('regular', ['test-tool', 'regular', 'disabled', 'First', 'Middle', 'Last']),
    ].filter(
      (item) => item.id === 'new-provider' || value.some((tool) => tool.provider_name === item.id),
    ),
    customTools: [],
    workflowTools: [],
    mcpTools: value.some((tool) => tool.provider_name === 'mcp-provider')
      ? [provider('mcp-provider', ['mcp-tool'], 'mcp')]
      : [],
  })
  const onChange = vi.fn()
  function ControlledSelector() {
    const [selected, setSelected] = useState(value)
    return (
      <MCPToolAvailabilityProvider versionSupported={versionSupported}>
        <MultipleToolSelector
          label="Tools"
          availableNodes={[]}
          nodeOutputVars={[]}
          {...options}
          value={selected}
          onChange={(next) => {
            onChange(next)
            setSelected(next)
          }}
        />
      </MCPToolAvailabilityProvider>
    )
  }
  return {
    ...renderWithConsoleQuery(<ControlledSelector />, {
      queryClient,
      systemFeatures: { enable_marketplace: false },
    }),
    onChange,
  }
}
const addButton = () =>
  screen.getByRole('button', { name: 'plugin.detailPanel.toolSelector.title' })
async function openProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.click(addButton())
  await user.click(await screen.findByRole('button', { name: /new-provider/ }))
}

it('adds the first tool, updates the enabled count and closes the selector', async () => {
  const user = userEvent.setup()
  const { onChange } = renderSelector()
  expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
  await openProvider(user)
  await user.click(await screen.findByRole('button', { name: 'new-tool' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({
      provider_name: 'new-provider',
      tool_name: 'new-tool',
      enabled: true,
    }),
  ])
  expect(screen.getByText('1/1')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText('plugin.detailPanel.toolSelector.empty')).not.toBeInTheDocument()
})

it('does not offer adding tools when disabled', () => {
  renderSelector({ disabled: true, value: [createToolValue()] })
  expect(
    screen.queryByRole('button', { name: 'plugin.detailPanel.toolSelector.title' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test Tool' })).toBeInTheDocument()
})

it('expands the collapsed tool list when opening the add selector', async () => {
  const user = userEvent.setup()
  renderSelector({ supportCollapse: true, value: [createToolValue()] })
  const collapse = screen.getByRole('button', { name: 'Tools' })
  await user.click(collapse)
  expect(collapse).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: 'Test Tool' })).not.toBeInTheDocument()
  await user.click(addButton())
  expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('button', { name: 'Test Tool' })).toBeVisible()
})

it.each([true, false])(
  'counts MCP tools only when versionSupported=%s allows them',
  (versionSupported) => {
    renderSelector({
      versionSupported,
      value: [
        createToolValue({ tool_name: 'regular' }),
        createToolValue({ provider_name: 'mcp-provider', tool_name: 'mcp-tool' }),
        createToolValue({ tool_name: 'disabled', enabled: false }),
      ],
    })
    expect(screen.getByText(versionSupported ? '2/3' : '1/3')).toBeInTheDocument()
  },
)

it('prevents selecting the same provider/tool twice while allowing matching names from another provider', async () => {
  const user = userEvent.setup()
  const existing = createToolValue({
    provider_name: 'different-provider',
    tool_name: 'new-tool',
    tool_label: 'Existing tool',
  })
  const { onChange } = renderSelector({ value: [existing] })
  await openProvider(user)
  await user.click(await screen.findByRole('button', { name: 'new-tool' }))
  expect(onChange).toHaveBeenLastCalledWith([
    existing,
    expect.objectContaining({ provider_name: 'new-provider', tool_name: 'new-tool' }),
  ])
  await openProvider(user)
  const picker = screen.getAllByRole('dialog').at(-1)!
  expect(within(picker).getByRole('button', { name: /^new-tool / })).toBeDisabled()
  expect(onChange).toHaveBeenCalledOnce()
})

it.each(['add', 'edit'])(
  'merges batch selections from the %s selector and preserves existing configuration',
  async (source) => {
    const user = userEvent.setup()
    const existing = createToolValue({
      provider_name: 'new-provider',
      tool_name: 'new-tool',
      enabled: false,
    })
    const { onChange } = renderSelector({ value: [existing] })
    if (source === 'add') await user.click(addButton())
    else {
      await user.click(screen.getByRole('button', { name: 'Test Tool' }))
      await user.click(screen.getByRole('button', { name: /new-tool/ }))
    }
    await user.click(await screen.findByRole('button', { name: /new-provider/ }))
    await user.click(screen.getByRole('button', { name: /workflow.tabs.addAll/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      existing,
      expect.objectContaining({
        provider_name: 'new-provider',
        tool_name: 'second-tool',
        enabled: true,
      }),
    ])
    expect(await screen.findByText('1/2')).toBeInTheDocument()
  },
)

it('updates only the toggled tool and keeps other configuration intact', async () => {
  const user = userEvent.setup()
  const values = ['First', 'Middle', 'Last'].map((name) =>
    createToolValue({ tool_name: name, tool_label: name }),
  )
  const { onChange } = renderSelector({ value: values })
  await user.click(screen.getAllByRole('switch')[1]!)
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    values[0],
    { ...values[1], enabled: false },
    values[2],
  ])
  expect(screen.getByText('2/3')).toBeInTheDocument()
})
