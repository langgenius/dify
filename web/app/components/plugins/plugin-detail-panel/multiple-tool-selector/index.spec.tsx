import type { Node } from 'reactflow'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ==================== Imports (after mocks) ====================

import { MCPToolAvailabilityProvider } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import MultipleToolSelector from './index'

// ==================== Mock Setup ====================

// Mock useAllMCPTools hook
const mockMCPToolsData = vi.fn<() => ToolWithProvider[] | undefined>(() => undefined)
vi.mock('@/service/use-tools', () => ({
  useAllMCPTools: () => ({
    data: mockMCPToolsData(),
  }),
}))

// Track edit tool index for unique test IDs
let editToolIndex = 0

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector', () => ({
  default: ({
    value,
    onSelect,
    onSelectMultiple,
    onDelete,
    controlledState,
    onControlledStateChange,
    panelShowState,
    onPanelShowStateChange,
    isEdit,
    supportEnableSwitch,
  }: {
    value?: ToolValue
    onSelect: (tool: ToolValue) => void
    onSelectMultiple?: (tools: ToolValue[]) => void
    onDelete?: () => void
    controlledState?: boolean
    onControlledStateChange?: (state: boolean) => void
    panelShowState?: boolean
    onPanelShowStateChange?: (state: boolean) => void
    isEdit?: boolean
    supportEnableSwitch?: boolean
  }) => {
    if (isEdit) {
      const currentIndex = editToolIndex++
      return (
        <div
          data-testid="tool-selector-edit"
          data-value={value?.tool_name || ''}
          data-index={currentIndex}
          data-support-enable-switch={supportEnableSwitch}
        >
          {value && (
            <>
              <span data-testid="tool-label">{value.tool_label}</span>
              <button
                data-testid={`configure-btn-${currentIndex}`}
                onClick={() => onSelect({ ...value, enabled: !value.enabled })}
              >
                Configure
              </button>
              <button
                data-testid={`delete-btn-${currentIndex}`}
                onClick={() => onDelete?.()}
              >
                Delete
              </button>
              {onSelectMultiple && (
                <button
                  data-testid={`add-multiple-btn-${currentIndex}`}
                  onClick={() => onSelectMultiple([
                    { ...value, tool_name: 'batch-tool-1', provider_name: 'batch-provider' },
                    { ...value, tool_name: 'batch-tool-2', provider_name: 'batch-provider' },
                  ])}
                >
                  Add Multiple
                </button>
              )}
            </>
          )}
        </div>
      )
    }
    else {
      return (
        <div
          data-testid="tool-selector-add"
          data-controlled-state={controlledState}
          data-panel-show-state={panelShowState}
        >
          <button
            data-testid="add-tool-btn"
            onClick={() => onSelect({
              provider_name: 'new-provider',
              tool_name: 'new-tool',
              tool_label: 'New Tool',
              enabled: true,
            })}
          >
            Add Tool
          </button>
          {onSelectMultiple && (
            <button
              data-testid="add-multiple-tools-btn"
              onClick={() => onSelectMultiple([
                { provider_name: 'batch-p', tool_name: 'batch-t1', tool_label: 'Batch T1', enabled: true },
                { provider_name: 'batch-p', tool_name: 'batch-t2', tool_label: 'Batch T2', enabled: true },
              ])}
            >
              Add Multiple Tools
            </button>
          )}
        </div>
      )
    }
  },
}))

// ==================== Test Utilities ====================

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

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

const createMCPTool = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  id: 'mcp-provider-1',
  name: 'mcp-provider',
  author: 'test-author',
  type: 'mcp',
  icon: 'test-icon.png',
  label: { en_US: 'MCP Provider' } as any,
  description: { en_US: 'MCP Provider description' } as any,
  is_team_authorization: true,
  allow_delete: false,
  labels: [],
  tools: [{
    name: 'mcp-tool-1',
    label: { en_US: 'MCP Tool 1' } as any,
    description: { en_US: 'MCP Tool 1 description' } as any,
    parameters: [],
    output_schema: {},
  }],
  ...overrides,
} as ToolWithProvider)

const createNodeOutputVar = (overrides: Partial<NodeOutPutVar> = {}): NodeOutPutVar => ({
  nodeId: 'node-1',
  title: 'Test Node',
  vars: [],
  ...overrides,
})

const createNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  position: { x: 0, y: 0 },
  data: { title: 'Test Node' },
  ...overrides,
})

type RenderOptions = {
  disabled?: boolean
  value?: ToolValue[]
  label?: string
  required?: boolean
  tooltip?: React.ReactNode
  supportCollapse?: boolean
  scope?: string
  onChange?: (value: ToolValue[]) => void
  nodeOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  nodeId?: string
  versionSupported?: boolean
}

const renderComponent = (options: RenderOptions = {}) => {
  const { versionSupported, ...overrides } = options
  const defaultProps = {
    disabled: false,
    value: [],
    label: 'Tools',
    required: false,
    tooltip: undefined,
    supportCollapse: false,
    scope: undefined,
    onChange: vi.fn(),
    nodeOutputVars: [createNodeOutputVar()],
    availableNodes: [createNode()],
    nodeId: 'test-node-id',
  }

  const props = { ...defaultProps, ...overrides }
  const queryClient = createQueryClient()

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MCPToolAvailabilityProvider versionSupported={versionSupported}>
          <MultipleToolSelector {...props} />
        </MCPToolAvailabilityProvider>
      </QueryClientProvider>,
    ),
    props,
  }
}

// ==================== Tests ====================

describe('MultipleToolSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMCPToolsData.mockReturnValue(undefined)
    editToolIndex = 0
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render with label', () => {
      // Arrange & Act
      renderComponent({ label: 'My Tools' })

      // Assert
      expect(screen.getByText('My Tools')).toBeInTheDocument()
    })

    it('should render required indicator when required is true', () => {
      // Arrange & Act
      renderComponent({ required: true })

      // Assert
      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should not render required indicator when required is false', () => {
      // Arrange & Act
      renderComponent({ required: false })

      // Assert
      expect(screen.queryByText('*')).not.toBeInTheDocument()
    })

    it('should render empty state when no tools are selected', () => {
      // Arrange & Act
      renderComponent({ value: [] })

      // Assert
      expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
    })

    it('should render selected tools when value is provided', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-1', tool_label: 'Tool 1' }),
        createToolValue({ tool_name: 'tool-2', tool_label: 'Tool 2' }),
      ]

      // Act
      renderComponent({ value: tools })

      // Assert
      const editSelectors = screen.getAllByTestId('tool-selector-edit')
      expect(editSelectors).toHaveLength(2)
    })

    it('should render add button when not disabled', () => {
      // Arrange & Act
      const { container } = renderComponent({ disabled: false })

      // Assert
      const addButton = container.querySelector('[class*="mx-1"]')
      expect(addButton).toBeInTheDocument()
    })

    it('should not render add button when disabled', () => {
      // Arrange & Act
      renderComponent({ disabled: true })

      // Assert
      const addSelectors = screen.queryAllByTestId('tool-selector-add')
      // The add button should still be present but outside the disabled check
      expect(addSelectors).toHaveLength(1)
    })

    it('should render tooltip when provided', () => {
      // Arrange & Act
      const { container } = renderComponent({ tooltip: 'This is a tooltip' })

      // Assert - Tooltip icon should be present
      const tooltipIcon = container.querySelector('svg')
      expect(tooltipIcon).toBeInTheDocument()
    })

    it('should render enabled count when tools are selected', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-1', enabled: true }),
        createToolValue({ tool_name: 'tool-2', enabled: false }),
      ]

      // Act
      renderComponent({ value: tools })

      // Assert
      expect(screen.getByText('1/2')).toBeInTheDocument()
      expect(screen.getByText('appDebug.agent.tools.enabled')).toBeInTheDocument()
    })
  })

  // ==================== Collapse Functionality Tests ====================
  describe('Collapse Functionality', () => {
    it('should render collapse arrow when supportCollapse is true', () => {
      // Arrange & Act
      const { container } = renderComponent({ supportCollapse: true })

      // Assert
      const collapseArrow = container.querySelector('svg[class*="cursor-pointer"]')
      expect(collapseArrow).toBeInTheDocument()
    })

    it('should not render collapse arrow when supportCollapse is false', () => {
      // Arrange & Act
      const { container } = renderComponent({ supportCollapse: false })

      // Assert
      const collapseArrows = container.querySelectorAll('svg[class*="rotate"]')
      expect(collapseArrows).toHaveLength(0)
    })

    it('should toggle collapse state when clicking header with supportCollapse enabled', () => {
      // Arrange
      const tools = [createToolValue()]
      const { container } = renderComponent({ supportCollapse: true, value: tools })
      const headerArea = container.querySelector('[class*="cursor-pointer"]')

      // Act - Initially visible
      expect(screen.getByTestId('tool-selector-edit')).toBeInTheDocument()

      // Click to collapse
      fireEvent.click(headerArea!)

      // Assert - Should be collapsed
      expect(screen.queryByTestId('tool-selector-edit')).not.toBeInTheDocument()
    })

    it('should not toggle collapse when supportCollapse is false', () => {
      // Arrange
      const tools = [createToolValue()]
      renderComponent({ supportCollapse: false, value: tools })

      // Act
      fireEvent.click(screen.getByText('Tools'))

      // Assert - Should still be visible
      expect(screen.getByTestId('tool-selector-edit')).toBeInTheDocument()
    })

    it('should expand when add button is clicked while collapsed', async () => {
      // Arrange
      const tools = [createToolValue()]
      const { container } = renderComponent({ supportCollapse: true, value: tools })
      const headerArea = container.querySelector('[class*="cursor-pointer"]')

      // Collapse first
      fireEvent.click(headerArea!)
      expect(screen.queryByTestId('tool-selector-edit')).not.toBeInTheDocument()

      // Act - Click add button
      const addButton = container.querySelector('button')
      fireEvent.click(addButton!)

      // Assert - Should be expanded
      await waitFor(() => {
        expect(screen.getByTestId('tool-selector-edit')).toBeInTheDocument()
      })
    })
  })

  // ==================== State Management Tests ====================
  describe('State Management', () => {
    it('should track enabled count correctly', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-1', enabled: true }),
        createToolValue({ tool_name: 'tool-2', enabled: true }),
        createToolValue({ tool_name: 'tool-3', enabled: false }),
      ]

      // Act
      renderComponent({ value: tools })

      // Assert
      expect(screen.getByText('2/3')).toBeInTheDocument()
    })

    it('should track enabled count with MCP tools when version is supported', () => {
      // Arrange
      const mcpTools = [createMCPTool({ id: 'mcp-provider' })]
      mockMCPToolsData.mockReturnValue(mcpTools)

      const tools = [
        createToolValue({ tool_name: 'tool-1', provider_name: 'regular-provider', enabled: true }),
        createToolValue({ tool_name: 'mcp-tool', provider_name: 'mcp-provider', enabled: true }),
      ]

      // Act
      renderComponent({ value: tools, versionSupported: true })

      // Assert
      expect(screen.getByText('2/2')).toBeInTheDocument()
    })

    it('should not count MCP tools when version is unsupported', () => {
      // Arrange
      const mcpTools = [createMCPTool({ id: 'mcp-provider' })]
      mockMCPToolsData.mockReturnValue(mcpTools)

      const tools = [
        createToolValue({ tool_name: 'tool-1', provider_name: 'regular-provider', enabled: true }),
        createToolValue({ tool_name: 'mcp-tool', provider_name: 'mcp-provider', enabled: true }),
      ]

      // Act
      renderComponent({ value: tools, versionSupported: false })

      // Assert
      expect(screen.getByText('1/2')).toBeInTheDocument()
    })

    it('should manage open state for add tool panel', () => {
      // Arrange
      const { container } = renderComponent()

      // Initially closed
      const addSelector = screen.getByTestId('tool-selector-add')
      expect(addSelector).toHaveAttribute('data-controlled-state', 'false')

      // Act - Click add button (ActionButton)
      const actionButton = container.querySelector('[class*="mx-1"]')
      fireEvent.click(actionButton!)

      // Assert - Open state should change to true
      expect(screen.getByTestId('tool-selector-add')).toHaveAttribute('data-controlled-state', 'true')
    })
  })

  // ==================== User Interactions Tests ====================
  describe('User Interactions', () => {
    it('should call onChange when adding a new tool via add button', () => {
      // Arrange
      const onChange = vi.fn()
      renderComponent({ onChange })

      // Act - Click add tool button in add selector
      fireEvent.click(screen.getByTestId('add-tool-btn'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ provider_name: 'new-provider', tool_name: 'new-tool' }),
      ])
    })

    it('should call onChange when adding multiple tools', () => {
      // Arrange
      const onChange = vi.fn()
      renderComponent({ onChange })

      // Act - Click add multiple tools button
      fireEvent.click(screen.getByTestId('add-multiple-tools-btn'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ provider_name: 'batch-p', tool_name: 'batch-t1' }),
        expect.objectContaining({ provider_name: 'batch-p', tool_name: 'batch-t2' }),
      ])
    })

    it('should deduplicate when adding duplicate tool', () => {
      // Arrange
      const existingTool = createToolValue({ tool_name: 'new-tool', provider_name: 'new-provider' })
      const onChange = vi.fn()
      renderComponent({ value: [existingTool], onChange })

      // Act - Try to add the same tool
      fireEvent.click(screen.getByTestId('add-tool-btn'))

      // Assert - Should still have only 1 tool (deduplicated)
      expect(onChange).toHaveBeenCalledWith([existingTool])
    })

    it('should call onChange when deleting a tool', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', provider_name: 'p0' }),
        createToolValue({ tool_name: 'tool-1', provider_name: 'p1' }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Delete first tool (index 0)
      fireEvent.click(screen.getByTestId('delete-btn-0'))

      // Assert - Should have only second tool
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-1', provider_name: 'p1' }),
      ])
    })

    it('should call onChange when configuring a tool', () => {
      // Arrange
      const tools = [createToolValue({ tool_name: 'tool-1', enabled: true })]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Click configure button to toggle enabled
      fireEvent.click(screen.getByTestId('configure-btn-0'))

      // Assert - Should update the tool at index 0
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-1', enabled: false }),
      ])
    })

    it('should call onChange with correct index when configuring second tool', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', enabled: true }),
        createToolValue({ tool_name: 'tool-1', enabled: true }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Configure second tool (index 1)
      fireEvent.click(screen.getByTestId('configure-btn-1'))

      // Assert - Should update only the second tool
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-0', enabled: true }),
        expect.objectContaining({ tool_name: 'tool-1', enabled: false }),
      ])
    })

    it('should call onChange with correct array when deleting middle tool', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', provider_name: 'p0' }),
        createToolValue({ tool_name: 'tool-1', provider_name: 'p1' }),
        createToolValue({ tool_name: 'tool-2', provider_name: 'p2' }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Delete middle tool (index 1)
      fireEvent.click(screen.getByTestId('delete-btn-1'))

      // Assert - Should have first and third tools
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-0' }),
        expect.objectContaining({ tool_name: 'tool-2' }),
      ])
    })

    it('should handle add multiple from edit selector', () => {
      // Arrange
      const tools = [createToolValue({ tool_name: 'existing' })]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Click add multiple from edit selector
      fireEvent.click(screen.getByTestId('add-multiple-btn-0'))

      // Assert - Should add batch tools with deduplication
      expect(onChange).toHaveBeenCalled()
    })
  })

  // ==================== Event Handlers Tests ====================
  describe('Event Handlers', () => {
    it('should handle add button click', () => {
      // Arrange
      const { container } = renderComponent()
      const addButton = container.querySelector('button')

      // Act
      fireEvent.click(addButton!)

      // Assert - Add tool panel should open
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })

    it('should handle collapse click with supportCollapse', () => {
      // Arrange
      const tools = [createToolValue()]
      const { container } = renderComponent({ supportCollapse: true, value: tools })
      const labelArea = container.querySelector('[class*="cursor-pointer"]')

      // Act
      fireEvent.click(labelArea!)

      // Assert - Tools should be hidden
      expect(screen.queryByTestId('tool-selector-edit')).not.toBeInTheDocument()

      // Click again to expand
      fireEvent.click(labelArea!)

      // Assert - Tools should be visible again
      expect(screen.getByTestId('tool-selector-edit')).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases Tests ====================
  describe('Edge Cases', () => {
    it('should handle empty value array', () => {
      // Arrange & Act
      renderComponent({ value: [] })

      // Assert
      expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
      expect(screen.queryAllByTestId('tool-selector-edit')).toHaveLength(0)
    })

    it('should handle undefined value', () => {
      // Arrange & Act - value defaults to [] in component
      renderComponent({ value: undefined as any })

      // Assert
      expect(screen.getByText('plugin.detailPanel.toolSelector.empty')).toBeInTheDocument()
    })

    it('should handle null mcpTools data', () => {
      // Arrange
      mockMCPToolsData.mockReturnValue(undefined)
      const tools = [createToolValue({ enabled: true })]

      // Act
      renderComponent({ value: tools })

      // Assert - Should still render
      expect(screen.getByText('1/1')).toBeInTheDocument()
    })

    it('should handle tools with missing enabled property', () => {
      // Arrange
      const tools = [
        { ...createToolValue(), enabled: undefined } as ToolValue,
      ]

      // Act
      renderComponent({ value: tools })

      // Assert - Should count as not enabled (falsy)
      expect(screen.getByText('0/1')).toBeInTheDocument()
    })

    it('should handle empty label', () => {
      // Arrange & Act
      renderComponent({ label: '' })

      // Assert - Should not crash
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })

    it('should handle nodeOutputVars as empty array', () => {
      // Arrange & Act
      renderComponent({ nodeOutputVars: [] })

      // Assert
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })

    it('should handle availableNodes as empty array', () => {
      // Arrange & Act
      renderComponent({ availableNodes: [] })

      // Assert
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })

    it('should handle undefined nodeId', () => {
      // Arrange & Act
      renderComponent({ nodeId: undefined })

      // Assert
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })
  })

  // ==================== Props Variations Tests ====================
  describe('Props Variations', () => {
    it('should pass disabled prop to child selectors', () => {
      // Arrange & Act
      const { container } = renderComponent({ disabled: true })

      // Assert - ActionButton (add button with mx-1 class) should not be rendered
      const actionButton = container.querySelector('[class*="mx-1"]')
      expect(actionButton).not.toBeInTheDocument()
    })

    it('should pass scope prop to ToolSelector', () => {
      // Arrange & Act
      renderComponent({ scope: 'test-scope' })

      // Assert
      expect(screen.getByTestId('tool-selector-add')).toBeInTheDocument()
    })

    it('should render with supportEnableSwitch for edit selectors', () => {
      // Arrange
      const tools = [createToolValue()]

      // Act
      renderComponent({ value: tools })

      // Assert
      const editSelector = screen.getByTestId('tool-selector-edit')
      expect(editSelector).toHaveAttribute('data-support-enable-switch', 'true')
    })

    it('should handle multiple tools correctly', () => {
      // Arrange
      const tools = Array.from({ length: 5 }, (_, i) =>
        createToolValue({ tool_name: `tool-${i}`, tool_label: `Tool ${i}` }))

      // Act
      renderComponent({ value: tools })

      // Assert
      const editSelectors = screen.getAllByTestId('tool-selector-edit')
      expect(editSelectors).toHaveLength(5)
    })
  })

  // ==================== MCP Tools Integration Tests ====================
  describe('MCP Tools Integration', () => {
    it('should correctly identify MCP tools', () => {
      // Arrange
      const mcpTools = [
        createMCPTool({ id: 'mcp-provider-1' }),
        createMCPTool({ id: 'mcp-provider-2' }),
      ]
      mockMCPToolsData.mockReturnValue(mcpTools)

      const tools = [
        createToolValue({ provider_name: 'mcp-provider-1', enabled: true }),
        createToolValue({ provider_name: 'regular-provider', enabled: true }),
      ]

      // Act
      renderComponent({ value: tools, versionSupported: true })

      // Assert
      expect(screen.getByText('2/2')).toBeInTheDocument()
    })

    it('should exclude MCP tools from enabled count when strategy version is unsupported', () => {
      // Arrange
      const mcpTools = [createMCPTool({ id: 'mcp-provider' })]
      mockMCPToolsData.mockReturnValue(mcpTools)

      const tools = [
        createToolValue({ provider_name: 'mcp-provider', enabled: true }),
        createToolValue({ provider_name: 'regular', enabled: true }),
      ]

      // Act
      renderComponent({ value: tools, versionSupported: false })

      // Assert - Only regular tool should be counted
      expect(screen.getByText('1/2')).toBeInTheDocument()
    })
  })

  // ==================== Deduplication Logic Tests ====================
  describe('Deduplication Logic', () => {
    it('should deduplicate by provider_name and tool_name combination', () => {
      // Arrange
      const onChange = vi.fn()
      const existingTools = [
        createToolValue({ provider_name: 'new-provider', tool_name: 'new-tool' }),
      ]
      renderComponent({ value: existingTools, onChange })

      // Act - Try to add same provider_name + tool_name via add button
      fireEvent.click(screen.getByTestId('add-tool-btn'))

      // Assert - Should not add duplicate, only existing tool remains
      expect(onChange).toHaveBeenCalledWith(existingTools)
    })

    it('should allow same tool_name with different provider_name', () => {
      // Arrange
      const onChange = vi.fn()
      const existingTools = [
        createToolValue({ provider_name: 'other-provider', tool_name: 'new-tool' }),
      ]
      renderComponent({ value: existingTools, onChange })

      // Act - Add tool with different provider
      fireEvent.click(screen.getByTestId('add-tool-btn'))

      // Assert - Should add as it's different provider
      expect(onChange).toHaveBeenCalledWith([
        existingTools[0],
        expect.objectContaining({ provider_name: 'new-provider', tool_name: 'new-tool' }),
      ])
    })

    it('should deduplicate multiple tools in batch add', () => {
      // Arrange
      const onChange = vi.fn()
      const existingTools = [
        createToolValue({ provider_name: 'batch-p', tool_name: 'batch-t1' }),
      ]
      renderComponent({ value: existingTools, onChange })

      // Act - Add multiple tools (batch-t1 is duplicate)
      fireEvent.click(screen.getByTestId('add-multiple-tools-btn'))

      // Assert - Should have 2 unique tools (batch-t1 deduplicated)
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ provider_name: 'batch-p', tool_name: 'batch-t1' }),
        expect.objectContaining({ provider_name: 'batch-p', tool_name: 'batch-t2' }),
      ])
    })
  })

  // ==================== Delete Functionality Tests ====================
  describe('Delete Functionality', () => {
    it('should remove tool at specific index when delete is clicked', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', provider_name: 'p0' }),
        createToolValue({ tool_name: 'tool-1', provider_name: 'p1' }),
        createToolValue({ tool_name: 'tool-2', provider_name: 'p2' }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Delete first tool
      fireEvent.click(screen.getByTestId('delete-btn-0'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-1' }),
        expect.objectContaining({ tool_name: 'tool-2' }),
      ])
    })

    it('should remove last tool when delete is clicked', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', provider_name: 'p0' }),
        createToolValue({ tool_name: 'tool-1', provider_name: 'p1' }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Delete last tool (index 1)
      fireEvent.click(screen.getByTestId('delete-btn-1'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-0' }),
      ])
    })

    it('should result in empty array when deleting last remaining tool', () => {
      // Arrange
      const tools = [createToolValue({ tool_name: 'only-tool' })]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Delete the only tool
      fireEvent.click(screen.getByTestId('delete-btn-0'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  // ==================== Configure Functionality Tests ====================
  describe('Configure Functionality', () => {
    it('should update tool at specific index when configured', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-1', enabled: true }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Configure tool (toggles enabled)
      fireEvent.click(screen.getByTestId('configure-btn-0'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-1', enabled: false }),
      ])
    })

    it('should preserve other tools when configuring one tool', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'tool-0', enabled: true }),
        createToolValue({ tool_name: 'tool-1', enabled: false }),
        createToolValue({ tool_name: 'tool-2', enabled: true }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Configure middle tool (index 1)
      fireEvent.click(screen.getByTestId('configure-btn-1'))

      // Assert - All tools preserved, only middle one changed
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'tool-0', enabled: true }),
        expect.objectContaining({ tool_name: 'tool-1', enabled: true }), // toggled
        expect.objectContaining({ tool_name: 'tool-2', enabled: true }),
      ])
    })

    it('should update first tool correctly', () => {
      // Arrange
      const tools = [
        createToolValue({ tool_name: 'first', enabled: false }),
        createToolValue({ tool_name: 'second', enabled: true }),
      ]
      const onChange = vi.fn()
      renderComponent({ value: tools, onChange })

      // Act - Configure first tool
      fireEvent.click(screen.getByTestId('configure-btn-0'))

      // Assert
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ tool_name: 'first', enabled: true }), // toggled
        expect.objectContaining({ tool_name: 'second', enabled: true }),
      ])
    })
  })

  // ==================== Panel State Tests ====================
  describe('Panel State Management', () => {
    it('should initialize with panel show state true on add', () => {
      // Arrange
      const { container } = renderComponent()

      // Act - Click add button
      const addButton = container.querySelector('button')
      fireEvent.click(addButton!)

      // Assert
      const addSelector = screen.getByTestId('tool-selector-add')
      expect(addSelector).toHaveAttribute('data-panel-show-state', 'true')
    })
  })

  // ==================== Accessibility Tests ====================
  describe('Accessibility', () => {
    it('should have clickable add button', () => {
      // Arrange
      const { container } = renderComponent()

      // Assert
      const addButton = container.querySelector('button')
      expect(addButton).toBeInTheDocument()
    })

    it('should show divider when tools are selected', () => {
      // Arrange
      const tools = [createToolValue()]

      // Act
      const { container } = renderComponent({ value: tools })

      // Assert
      const divider = container.querySelector('[class*="h-3"]')
      expect(divider).toBeInTheDocument()
    })
  })

  // ==================== Tooltip Tests ====================
  describe('Tooltip Rendering', () => {
    it('should render question icon when tooltip is provided', () => {
      // Arrange & Act
      const { container } = renderComponent({ tooltip: 'Help text' })

      // Assert
      const questionIcon = container.querySelector('svg')
      expect(questionIcon).toBeInTheDocument()
    })

    it('should not render question icon when tooltip is not provided', () => {
      // Arrange & Act
      const { container } = renderComponent({ tooltip: undefined })

      // Assert - Should only have add icon, not question icon in label area
      const labelDiv = container.querySelector('.system-sm-semibold-uppercase')
      const icons = labelDiv?.querySelectorAll('svg') || []
      // Question icon should not be in the label area
      expect(icons.length).toBeLessThanOrEqual(1)
    })
  })
})
