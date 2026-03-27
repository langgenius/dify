import type { ToolNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const mockUseNodePluginInstallation = vi.hoisted(() => vi.fn())
const mockUseCurrentToolCollection = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks/use-node-plugin-installation', () => ({
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
})
