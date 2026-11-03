import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import MultipleToolSelector from '../index'

const createToolValue = (index: number): ToolValue => ({
  provider_name: `provider-${index}`,
  tool_name: `tool-${index}`,
  tool_label: `Tool ${index}`,
  enabled: true,
})

const createToolProvider = (value: ToolValue) =>
  createToolProviderFixture({
    id: value.provider_name,
    name: value.provider_name,
    is_team_authorization: true,
    allow_delete: false,
    tools: [
      {
        name: value.tool_name,
        author: 'Dify',
        label: { en_US: value.tool_label },
        description: { en_US: '' },
        parameters: [],
      },
    ],
  })

function renderSelector(initialValue: ToolValue[]) {
  const queryClient = createConsoleQueryClient()
  seedToolProviders(queryClient, {
    builtInTools: initialValue.map(createToolProvider),
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  const onChange = vi.fn()

  function Harness() {
    const [value, setValue] = useState(initialValue)

    return (
      <MCPToolAvailabilityProvider versionSupported>
        <MultipleToolSelector
          value={value}
          label="Tools"
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          nodeOutputVars={[]}
          availableNodes={[]}
        />
      </MCPToolAvailabilityProvider>
    )
  }

  return { ...renderWithConsoleQuery(<Harness />, { queryClient }), onChange }
}

describe('MultipleToolSelector focus restoration', () => {
  it.each([
    {
      name: 'the next tool after deleting a middle item',
      tools: [createToolValue(1), createToolValue(2), createToolValue(3)],
      deleteIndex: 1,
      expectedFocusName: 'Tool 3',
    },
    {
      name: 'the previous tool after deleting the last item',
      tools: [createToolValue(1), createToolValue(2)],
      deleteIndex: 1,
      expectedFocusName: 'Tool 1',
    },
    {
      name: 'the add button after deleting the only item',
      tools: [createToolValue(1)],
      deleteIndex: 0,
      expectedFocusName: 'plugin.detailPanel.toolSelector.title',
    },
  ])('moves focus to $name', async ({ tools, deleteIndex, expectedFocusName }) => {
    const user = userEvent.setup()
    const { onChange } = renderSelector(tools)

    const deleteButton = screen.getAllByRole('button', {
      name: 'common.operation.delete',
    })[deleteIndex]!
    deleteButton.focus()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      tools.filter((_, index) => index !== deleteIndex),
    )
    expect(
      screen.queryByRole('button', { name: tools[deleteIndex]!.tool_label }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: expectedFocusName })).toHaveFocus()
  })
})
