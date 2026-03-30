import type { Node } from 'reactflow'
import type { Tool } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { NodeOutPutVar, ToolWithProvider } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import ToolSettingsSection from '../tool-settings-section'

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  getPlainValue: vi.fn((value: Record<string, unknown>) => value),
  getStructureValue: vi.fn(() => ({ structured: 'settings' })),
  toolParametersToFormSchemas: vi.fn((schemas: unknown[]) => schemas),
}))

vi.mock('@/app/components/workflow/nodes/tool/components/tool-form', () => ({
  default: ({
    onChange,
    schema,
  }: {
    onChange: (value: Record<string, unknown>) => void
    schema: unknown[]
  }) => (
    <div data-testid="tool-form">
      <span>{`schema-count:${schema.length}`}</span>
      <button onClick={() => onChange({ raw: 'settings' })}>Change Settings</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form', () => ({
  default: ({
    onChange,
    nodeId,
    schemas,
  }: {
    onChange: (value: Record<string, unknown>) => void
    nodeId: string
    schemas: unknown[]
  }) => (
    <div data-testid="reasoning-config-form">
      <span>{`node:${nodeId}`}</span>
      <span>{`schema-count:${schemas.length}`}</span>
      <button onClick={() => onChange({ reasoning: { auto: 0, value: { temperature: 0.7 } } })}>Change Params</button>
    </div>
  ),
}))

const createProvider = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  name: 'provider',
  is_team_authorization: true,
  ...overrides,
} as ToolWithProvider)

const createTool = (parameters: Array<{ form: string, name: string }>): Tool => ({
  parameters,
} as unknown as Tool)

const createValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'provider',
  tool_name: 'tool',
  settings: {
    setting1: {
      value: 'initial',
    },
  },
  parameters: {
    reasoning: {
      auto: 0,
      value: {
        temperature: 0.2,
      },
    },
  },
  ...overrides,
} as ToolValue)

const nodeOutputVars: NodeOutPutVar[] = []
const availableNodes: Node[] = []

describe('sections/tool-settings-section', () => {
  it('should render nothing when provider is not team authorized', () => {
    const { container } = render(
      <ToolSettingsSection
        currentProvider={createProvider({ is_team_authorization: false })}
        currentTool={createTool([{ form: 'form', name: 'setting1' }])}
        value={createValue()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should render nothing when tool has no settings or params', () => {
    const { container } = render(
      <ToolSettingsSection
        currentProvider={createProvider()}
        currentTool={createTool([])}
        value={createValue()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should render user settings only and save structured settings', () => {
    const onChange = vi.fn()

    render(
      <ToolSettingsSection
        currentProvider={createProvider()}
        currentTool={createTool([{ form: 'form', name: 'setting1' }])}
        value={createValue()}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('plugin.detailPanel.toolSelector.settings')).toBeInTheDocument()
    expect(screen.getByTestId('tool-form')).toBeInTheDocument()
    expect(screen.queryByTestId('reasoning-config-form')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change Settings' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      settings: { structured: 'settings' },
    }))
  })

  it('should render reasoning config only and save parameters', () => {
    const onChange = vi.fn()

    render(
      <ToolSettingsSection
        currentProvider={createProvider()}
        currentTool={createTool([{ form: 'llm', name: 'reasoning' }])}
        value={createValue()}
        nodeId="node-1"
        nodeOutputVars={nodeOutputVars}
        availableNodes={availableNodes}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('plugin.detailPanel.toolSelector.params')).toBeInTheDocument()
    expect(screen.getByText('plugin.detailPanel.toolSelector.paramsTip1')).toBeInTheDocument()
    expect(screen.getByTestId('reasoning-config-form')).toHaveTextContent('node:node-1')
    expect(screen.getByTestId('tool-form')).toHaveTextContent('schema-count:0')

    fireEvent.click(screen.getByRole('button', { name: 'Change Params' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      parameters: {
        reasoning: {
          auto: 0,
          value: {
            temperature: 0.7,
          },
        },
      },
    }))
  })

  it('should render tab slider and switch from settings to params when both forms exist', () => {
    render(
      <ToolSettingsSection
        currentProvider={createProvider()}
        currentTool={createTool([
          { form: 'form', name: 'setting1' },
          { form: 'llm', name: 'reasoning' },
        ])}
        value={createValue()}
        nodeId="node-2"
        nodeOutputVars={nodeOutputVars}
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByTestId('tab-slider')).toBeInTheDocument()
    expect(screen.getByTestId('tool-form')).toBeInTheDocument()
    expect(screen.queryByText('plugin.detailPanel.toolSelector.paramsTip1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tab-slider-item-params'))

    expect(screen.getByText('plugin.detailPanel.toolSelector.paramsTip1')).toBeInTheDocument()
    expect(screen.getByText('plugin.detailPanel.toolSelector.paramsTip2')).toBeInTheDocument()
    expect(screen.getByTestId('reasoning-config-form')).toHaveTextContent('schema-count:1')
  })
})
