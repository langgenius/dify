import type { ComponentProps } from 'react'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, isValidElement, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MultipleToolSelector from '../index'

const mcpTools = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.mcp.get': mcpTools,
    }),
  }
})

// Tool selection/configuration is independently tested. This boundary supplies selections
// so these tests can focus on array merging, collapsed state and focus ownership.
vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector', () => ({
  default: ({
    value,
    onSelect,
    onSelectMultiple,
    onDelete,
    trigger,
    triggerRef,
    controlledState,
    onControlledStateChange,
    isEdit,
  }: ComponentProps<typeof import('../../tool-selector').default>) => {
    const added = {
      provider_name: 'new-provider',
      tool_name: 'new-tool',
      tool_label: 'New tool',
      enabled: true,
    }
    const batch = [added, { ...added, tool_name: 'second-tool', tool_label: 'Second tool' }]
    if (isEdit && value)
      return (
        <fieldset aria-label={value.tool_label}>
          <button ref={triggerRef} onClick={() => onSelect({ ...value, enabled: !value.enabled })}>
            Configure {value.tool_label}
          </button>
          <button onClick={onDelete}>Delete {value.tool_label}</button>
          <button onClick={() => onSelectMultiple?.(batch)}>Add related tools</button>
        </fieldset>
      )
    return (
      <>
        {isValidElement<React.HTMLAttributes<HTMLElement>>(trigger) &&
          cloneElement(trigger, {
            onClick: (event) => {
              trigger.props.onClick?.(event)
              onControlledStateChange?.(!controlledState)
            },
          })}
        {controlledState && (
          <fieldset aria-label="Available tools">
            <button onClick={() => onSelect(added)}>Select new tool</button>
            <button onClick={() => onSelectMultiple?.(batch)}>Select both tools</button>
          </fieldset>
        )}
      </>
    )
  },
}))

const createToolValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'test-provider',
  provider_show_name: 'Test Provider',
  tool_name: 'test-tool',
  tool_label: 'Test Tool',
  tool_description: 'Test tool description',
  settings: {},
  parameters: {},
  enabled: true,
  extra: { description: 'Test description' },
  ...overrides,
})

const createMCPTool = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider =>
  ({
    id: 'mcp-provider-1',
    name: 'mcp-provider',
    author: 'test-author',
    type: 'mcp',
    icon: 'test-icon.png',
    label: { en_US: 'MCP Provider' } as unknown as ToolWithProvider['label'],
    description: {
      en_US: 'MCP Provider description',
    } as unknown as ToolWithProvider['description'],
    is_team_authorization: true,
    allow_delete: false,
    labels: [],
    tools: [
      {
        name: 'mcp-tool-1',
        label: { en_US: 'MCP Tool 1' } as unknown as ToolWithProvider['label'],
        description: {
          en_US: 'MCP Tool 1 description',
        } as unknown as ToolWithProvider['description'],
        parameters: [],
        output_schema: {},
      },
    ],
    ...overrides,
  }) as ToolWithProvider

type Options = Partial<ComponentProps<typeof MultipleToolSelector>> & { versionSupported?: boolean }
const renderSelector = ({ value = [], versionSupported = true, ...options }: Options = {}) => {
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
  return { ...renderWithConsoleQuery(<ControlledSelector />), onChange }
}
const addButton = () =>
  screen.getByRole('button', { name: 'plugin.detailPanel.toolSelector.title' })

beforeEach(() => {
  vi.clearAllMocks()
  mcpTools.mockResolvedValue([])
})

describe('multiple tool selection', () => {
  it('adds the first tool, updates the enabled count and closes the selector', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector({ required: true })
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
    await user.click(addButton())
    await user.click(screen.getByRole('button', { name: 'Select new tool' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      {
        provider_name: 'new-provider',
        tool_name: 'new-tool',
        tool_label: 'New tool',
        enabled: true,
      },
    ])
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Available tools' })).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.detailPanel.toolSelector.empty')).not.toBeInTheDocument()
  })

  it('does not offer adding tools when disabled', () => {
    renderSelector({ disabled: true, value: [createToolValue()] })
    expect(
      screen.queryByRole('button', { name: 'plugin.detailPanel.toolSelector.title' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Test Tool' })).toBeInTheDocument()
  })

  it('collapses from the keyboard and expands again when opening the add selector', async () => {
    const user = userEvent.setup()
    renderSelector({ supportCollapse: true, value: [createToolValue()] })
    const collapse = screen.getByRole('button', { name: 'Tools' })
    await user.tab()
    expect(collapse).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(collapse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Test Tool' })).not.toBeInTheDocument()
    await user.click(addButton())
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('group', { name: 'Test Tool' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Available tools' })).toBeInTheDocument()
  })

  it.each([true, false])(
    'counts enabled MCP tools only when versionSupported=%s allows them',
    async (versionSupported) => {
      mcpTools.mockResolvedValue([createMCPTool({ id: 'mcp-provider' })])
      const { queryClient } = renderSelector({
        versionSupported,
        value: [
          createToolValue({ provider_name: 'regular', tool_name: 'regular' }),
          createToolValue({ provider_name: 'mcp-provider', tool_name: 'mcp-tool' }),
          createToolValue({ provider_name: 'regular', tool_name: 'disabled', enabled: false }),
        ],
      })
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      expect(mcpTools).toHaveBeenCalledOnce()
      expect(screen.getByText(versionSupported ? '2/3' : '1/3')).toBeInTheDocument()
    },
  )

  it.each([
    { provider_name: 'new-provider', expectedLength: 1 },
    { provider_name: 'different-provider', expectedLength: 2 },
  ])(
    'deduplicates by provider and tool identity for $provider_name',
    async ({ provider_name, expectedLength }) => {
      const user = userEvent.setup()
      const existing = createToolValue({
        provider_name,
        tool_name: 'new-tool',
        tool_label: 'Existing tool',
      })
      const { onChange } = renderSelector({ value: [existing] })
      await user.click(addButton())
      await user.click(screen.getByRole('button', { name: 'Select new tool' }))
      const expected =
        expectedLength === 1
          ? [existing]
          : [
              existing,
              {
                provider_name: 'new-provider',
                tool_name: 'new-tool',
                tool_label: 'New tool',
                enabled: true,
              },
            ]
      expect(onChange).toHaveBeenCalledExactlyOnceWith(expected)
    },
  )

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
      if (source === 'add') {
        await user.click(addButton())
        await user.click(screen.getByRole('button', { name: 'Select both tools' }))
      } else await user.click(screen.getByRole('button', { name: 'Add related tools' }))
      expect(onChange).toHaveBeenCalledExactlyOnceWith([
        existing,
        {
          provider_name: 'new-provider',
          tool_name: 'second-tool',
          tool_label: 'Second tool',
          enabled: true,
        },
      ])
      expect(screen.getByText('1/2')).toBeInTheDocument()
    },
  )

  it('updates only the configured tool and keeps other values intact', async () => {
    const user = userEvent.setup()
    const values = ['First', 'Middle', 'Last'].map((name) =>
      createToolValue({ tool_name: name, tool_label: name }),
    )
    const { onChange } = renderSelector({ value: values })
    await user.click(screen.getByRole('button', { name: 'Configure Middle' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      values[0],
      { ...values[1], enabled: false },
      values[2],
    ])
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })

  it.each([
    {
      names: ['First', 'Middle', 'Last'],
      deleted: 'Middle',
      remaining: ['First', 'Last'],
      focus: 'Configure Last',
    },
    { names: ['First', 'Last'], deleted: 'Last', remaining: ['First'], focus: 'Configure First' },
    {
      names: ['Only'],
      deleted: 'Only',
      remaining: [],
      focus: 'plugin.detailPanel.toolSelector.title',
    },
  ])(
    'deletes $deleted and restores focus to $focus',
    async ({ names, deleted, remaining, focus }) => {
      const user = userEvent.setup()
      const values = names.map((name) => createToolValue({ tool_name: name, tool_label: name }))
      const { onChange } = renderSelector({ value: values })
      await user.click(
        within(screen.getByRole('group', { name: deleted })).getByRole('button', {
          name: `Delete ${deleted}`,
        }),
      )
      expect(onChange).toHaveBeenCalledExactlyOnceWith(
        values.filter((value) => remaining.includes(value.tool_name)),
      )
      expect(screen.queryByRole('group', { name: deleted })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: focus })).toHaveFocus()
    },
  )
})
