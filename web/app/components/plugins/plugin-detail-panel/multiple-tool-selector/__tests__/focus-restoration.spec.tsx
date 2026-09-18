import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import MultipleToolSelector from '../index'

const mockTools = vi.hoisted(() => ({
  builtIn: [] as ToolWithProvider[],
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockTools.builtIn, isFetched: true }),
  useAllCustomTools: () => ({ data: [], isFetched: true }),
  useAllMCPTools: () => ({ data: [], isFetched: true }),
  useAllWorkflowTools: () => ({ data: [], isFetched: true }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: () => ({ data: undefined }),
  useInvalidateInstalledPluginList: () => vi.fn(),
  usePluginManifestInfo: () => ({ data: undefined }),
}))

const createToolValue = (index: number): ToolValue => ({
  provider_name: `provider-${index}`,
  tool_name: `tool-${index}`,
  tool_label: `Tool ${index}`,
  enabled: true,
})

const createToolProvider = (value: ToolValue): ToolWithProvider => ({
  id: value.provider_name,
  name: value.provider_name,
  author: 'Dify',
  description: { en_US: '', zh_Hans: '' },
  icon: 'icon.svg',
  label: { en_US: value.provider_name, zh_Hans: value.provider_name },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
  labels: [],
  tools: [
    {
      name: value.tool_name,
      author: 'Dify',
      label: { en_US: value.tool_label, zh_Hans: value.tool_label },
      description: { en_US: '', zh_Hans: '' },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
  meta: {} as ToolWithProvider['meta'],
})

function renderSelector(initialValue: ToolValue[]) {
  mockTools.builtIn = initialValue.map(createToolProvider)

  function Harness() {
    const [value, setValue] = useState(initialValue)

    return (
      <MCPToolAvailabilityProvider versionSupported>
        <MultipleToolSelector
          value={value}
          label="Tools"
          onChange={setValue}
          nodeOutputVars={[]}
          availableNodes={[]}
        />
      </MCPToolAvailabilityProvider>
    )
  }

  return render(<Harness />)
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
    renderSelector(tools)

    const deleteButton = screen.getAllByRole('button', {
      name: 'common.operation.delete',
    })[deleteIndex]
    deleteButton?.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: expectedFocusName })).toHaveFocus()
  })
})
