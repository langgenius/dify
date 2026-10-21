import type { ToolNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const mockUseNodePluginInstallation = vi.hoisted(() => vi.fn())
const mockUseCurrentToolCollection = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useNodes: mockUseNodes,
}))

vi.mock('../../../hooks/use-node-plugin-installation', () => ({
  useNodePluginInstallation: mockUseNodePluginInstallation,
}))

vi.mock('../hooks/use-current-tool-collection', () => ({
  __esModule: true,
  default: mockUseCurrentToolCollection,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: () => <button type="button">Install Plugin</button>,
}))

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

describe('ToolNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodePluginInstallation.mockReturnValue({
      isChecking: false,
      isMissing: false,
      uniqueIdentifier: undefined,
      canInstall: false,
      onInstallSuccess: vi.fn(),
      shouldDim: false,
    })
    mockUseCurrentToolCollection.mockReturnValue({
      currentTools: [],
      currCollection: undefined,
    })
    mockUseNodes.mockReset()
    mockUseNodes.mockReturnValue([])
  })

  describe('Authorization Warning', () => {
    it('should render the authorization warning when the tool requires authorization and is not authorized', () => {
      mockUseCurrentToolCollection.mockReturnValue({
        currentTools: [],
        currCollection: {
          allow_delete: true,
          is_team_authorization: false,
        },
      })

      render(<Node id="tool-node-1" data={createNodeData()} />)

      expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    })

    it('should keep configuration rows visible when the authorization warning is shown', () => {
      mockUseCurrentToolCollection.mockReturnValue({
        currentTools: [],
        currCollection: {
          allow_delete: true,
          is_team_authorization: false,
        },
      })

      render(
        <Node
          id="tool-node-1"
          data={createNodeData({
            tool_configurations: {
              region: { value: 'us' },
            },
          })}
        />,
      )

      expect(screen.getByText('region')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
    })

    it('should render nothing when there are no configs, no install action and no authorization warning', () => {
      const { container } = render(<Node id="tool-node-1" data={createNodeData()} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('Configuration summaries', () => {
    it('subscribes to real React Flow node updates for the rendered canvas summary', async () => {
      const {
        ReactFlowProvider,
        useNodes,
        useReactFlow,
        default: ReactFlow,
      } = await vi.importActual<typeof import('reactflow')>('reactflow')
      mockUseNodes.mockImplementation(useNodes)
      const upstream = { id: 'upload', position: { x: 0, y: 0 }, data: { title: 'Upload' } }
      const data = createNodeData({
        tool_configurations: {
          file: { type: 'variable', value: ['upload', 'files'] },
          model: {
            type: 'constant',
            value: { provider: 'openai', model: 'gpt-4o', model_type: 'llm' },
          },
        },
      })
      const Canvas = () => {
        const { setNodes } = useReactFlow()
        return (
          <>
            <button type="button" onClick={() => setNodes([upstream])}>
              Load nodes
            </button>
            <button
              type="button"
              onClick={() => setNodes([{ ...upstream, data: { title: 'Renamed upload' } }])}
            >
              Rename node
            </button>
            <button type="button" onClick={() => setNodes([])}>
              Remove node
            </button>
            <Node id="tool-node-1" data={data} />
          </>
        )
      }
      const { default: userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      render(
        <ReactFlowProvider>
          <ReactFlow defaultNodes={[]} defaultEdges={[]} />
          <Canvas />
        </ReactFlowProvider>,
      )
      expect(screen.getByText('upload, files')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Load nodes' }))
      expect(screen.getByText('Upload / files')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Rename node' }))
      expect(screen.getByText('Renamed upload / files')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Remove node' }))
      expect(screen.getByText('upload, files')).toBeInTheDocument()
      mockUseNodes.mockReset()
    })
    it('resolves a file variable to its upstream node title and nested variable path', () => {
      mockUseNodes.mockReturnValue([{ id: '1730000000', data: { title: 'Uploaded documents' } }])
      render(
        <Node
          id="tool-node-1"
          data={createNodeData({
            tool_configurations: {
              file: { type: 'variable', value: ['1730000000', 'files', 'document'] },
            },
          })}
        />,
      )
      expect(screen.getByText('Uploaded documents / files.document')).toBeInTheDocument()
      expect(screen.queryByText('1730000000, files, document')).not.toBeInTheDocument()
    })

    it('keeps an unresolved variable selector readable', () => {
      render(
        <Node
          id="tool-node-1"
          data={createNodeData({
            tool_configurations: { file: { type: 'variable', value: ['deleted-node', 'files'] } },
          })}
        />,
      )
      expect(screen.getByText('deleted-node, files')).toBeInTheDocument()
    })

    it('does not resolve constant multi-select choices as node identifiers', () => {
      mockUseNodes.mockReturnValue([{ id: 'png', data: { title: 'Unrelated node' } }])
      render(
        <Node
          id="tool-node-1"
          data={createNodeData({
            tool_configurations: { formats: { type: 'constant', value: ['png', 'svg'] } },
          })}
        />,
      )
      expect(screen.getByText('png, svg')).toBeInTheDocument()
      expect(screen.queryByText('Unrelated node / svg')).not.toBeInTheDocument()
    })

    it('renders the selected model from a constant model-selector value', () => {
      render(
        <Node
          id="tool-node-1"
          data={createNodeData({
            tool_configurations: {
              model: {
                type: 'constant',
                value: { provider: 'openai', model: 'gpt-4o', model_type: 'llm' },
              },
            },
          })}
        />,
      )
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    })

    it('updates the variable summary when the upstream node is renamed', () => {
      const data = createNodeData({
        tool_configurations: { file: { type: 'variable', value: ['source', 'files'] } },
      })
      mockUseNodes.mockReturnValue([{ id: 'source', data: { title: 'Original title' } }])
      const { rerender } = render(<Node id="tool-node-1" data={data} />)
      expect(screen.getByText('Original title / files')).toBeInTheDocument()
      mockUseNodes.mockReturnValue([{ id: 'source', data: { title: 'Renamed source' } }])
      rerender(<Node id="tool-node-1" data={{ ...data }} />)
      expect(screen.getByText('Renamed source / files')).toBeInTheDocument()
      expect(screen.queryByText('Original title / files')).not.toBeInTheDocument()
    })
  })

  it('should render multi-select configuration values', () => {
    render(
      <Node
        id="tool-node-1"
        data={createNodeData({
          tool_configurations: {
            formats: { type: 'constant', value: ['png', 'svg'] },
          },
        })}
      />,
    )

    expect(screen.getByTitle('png, svg')).toHaveTextContent('png, svg')
  })
})
