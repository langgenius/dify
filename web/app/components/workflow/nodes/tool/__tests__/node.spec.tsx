import type { ToolNodeType } from '../types'
import { act, screen } from '@testing-library/react'
import { createAppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const mockUseNodePluginInstallation = vi.hoisted(() => vi.fn())
const mockUseCurrentToolCollection = vi.hoisted(() => vi.fn())

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

      renderWorkflowComponent(<Node id="tool-node-1" data={createNodeData()} />)

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

      renderWorkflowComponent(
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
      const { container } = renderWorkflowComponent(
        <Node id="tool-node-1" data={createNodeData()} />,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })

  it('should render multi-select configuration values', () => {
    renderWorkflowComponent(
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

  it('updates App user errors on the canvas immediately as the draft changes', () => {
    const data = createNodeData()
    const { store } = renderWorkflowComponent(<Node id="tool-node-1" data={data} />)
    const draft = createAppUserAuthDraft()
    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google', data.provider_id, draft)
      store
        .getState()
        .setNodeAuthorizationTab('tool-node-1', 'google', data.provider_id, 'app-user-auth')
    })
    expect(screen.getByText('plugin.auth.appUser.clientRequired')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google', data.provider_id, {
        ...draft,
        oauthEnabled: false,
      })
    })
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google', data.provider_id, {
        ...draft,
        oauthEnabled: false,
        description: 'Find repositories',
      })
    })
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()

    act(() => {
      store.getState().setNodeAppUserAuthDraft('tool-node-1', 'google', data.provider_id, {
        ...draft,
        oauthEnabled: false,
        apiKeyEnabled: false,
        description: ' ',
      })
    })
    expect(screen.getByText('plugin.auth.appUser.selectMethod')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.clientRequired')).not.toBeInTheDocument()
  })

  it('does not show errors for a different provider', () => {
    const data = createNodeData()
    const { store, rerender } = renderWorkflowComponent(<Node id="tool-node-1" data={data} />)
    act(() => {
      store
        .getState()
        .setNodeAppUserAuthDraft(
          'tool-node-1',
          'google',
          data.provider_id,
          createAppUserAuthDraft(),
        )
      store
        .getState()
        .setNodeAuthorizationTab('tool-node-1', 'google', data.provider_id, 'app-user-auth')
    })
    expect(screen.getByText('plugin.auth.appUser.descriptionRequired')).toBeInTheDocument()
    rerender(<Node id="tool-node-1" data={createNodeData({ provider_id: 'github' })} />)
    expect(screen.queryByText('plugin.auth.appUser.descriptionRequired')).not.toBeInTheDocument()
  })
})
