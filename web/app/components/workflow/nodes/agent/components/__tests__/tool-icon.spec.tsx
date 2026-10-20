import type { ToolProviderApiEntityResponse as ToolProvider } from '@dify/contracts/api/console/workspaces/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { ToolIcon } from '../tool-icon'

let mockBuiltInTools: ToolProvider[] | undefined
let mockCustomTools: ToolProvider[] | undefined
let mockWorkflowTools: ToolProvider[] | undefined
let mockMcpTools: ToolProvider[] | undefined

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => mockBuiltInTools ?? new Promise(() => {}),
      'workspaces.current.tools.api.get': async () => mockCustomTools ?? new Promise(() => {}),
      'workspaces.current.tools.workflow.get': async () =>
        mockWorkflowTools ?? new Promise(() => {}),
      'workspaces.current.tools.mcp.get': async () => mockMcpTools ?? new Promise(() => {}),
    }),
  }
})

describe('agent/tool-icon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuiltInTools = []
    mockCustomTools = []
    mockWorkflowTools = []
    mockMcpTools = []
  })

  it('should render a string icon, recover from fetch errors, and keep installed tools warning-free', async () => {
    mockBuiltInTools = [
      createToolProviderFixture({
        name: 'author/tool-a',
        icon: 'https://example.com/tool-a.png',
        is_team_authorization: true,
      }),
    ]

    render(<ToolIcon id="tool-1" providerName="author/tool-a" />)

    const icon = await screen.findByRole('img', { name: 'tool icon' })
    expect(icon).toHaveAttribute('src', 'https://example.com/tool-a.png')

    expect(screen.queryByText(/toolNot(?:Install|Authorized)Tooltip/)).not.toBeInTheDocument()

    fireEvent.error(icon)
    expect(screen.queryByRole('img', { name: 'tool icon' })).not.toBeInTheDocument()
  })

  it('should render authorization and installation warnings with the correct icon sources', async () => {
    mockWorkflowTools = [
      createToolProviderFixture({
        id: 'author/tool-b',
        icon: {
          content: 'B',
          background: '#fff',
        },
        is_team_authorization: false,
      }),
    ]

    const { rerender } = render(<ToolIcon id="tool-2" providerName="author/tool-b" />)

    expect(
      await screen.findByText('workflow.nodes.agent.toolNotAuthorizedTooltip:{"tool":"tool-b"}'),
    ).toBeInTheDocument()

    mockWorkflowTools = []
    rerender(<ToolIcon id="tool-3" providerName="market/tool-c" />)

    const marketplaceIcon = await screen.findByRole('img', { name: 'tool icon' })
    expect(marketplaceIcon).toHaveAttribute(
      'src',
      `${MARKETPLACE_API_PREFIX}/plugins/market/tool-c/icon`,
    )
    expect(
      screen.getByText('workflow.nodes.agent.toolNotInstallTooltip:{"tool":"tool-c"}'),
    ).toBeInTheDocument()
  })

  it('does not show a broken image or authorization warning while tool data is loading', () => {
    mockBuiltInTools = undefined

    render(<ToolIcon id="tool-4" providerName="author/tool-d" />)
    expect(screen.queryByText(/toolNot(?:Install|Authorized)Tooltip/)).not.toBeInTheDocument()

    expect(screen.queryByRole('img', { name: 'tool icon' })).not.toBeInTheDocument()
  })
})
