import { fireEvent, render, screen } from '@testing-library/react'
import { ToolIcon } from '../tool-icon'

type ToolProvider = {
  id?: string
  name?: string
  icon?: string | { content: string, background: string }
  is_team_authorization?: boolean
}

let mockBuiltInTools: ToolProvider[] | undefined
let mockCustomTools: ToolProvider[] | undefined
let mockWorkflowTools: ToolProvider[] | undefined
let mockMcpTools: ToolProvider[] | undefined
let mockMarketplaceIcon: string | { content: string, background: string } | undefined

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuiltInTools }),
  useAllCustomTools: () => ({ data: mockCustomTools }),
  useAllWorkflowTools: () => ({ data: mockWorkflowTools }),
  useAllMCPTools: () => ({ data: mockMcpTools }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({
    icon,
    background,
    className,
  }: {
    icon?: string
    background?: string
    className?: string
  }) => <div className={className}>{`app-icon:${background}:${icon}`}</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Group: ({ className }: { className?: string }) => <div className={className}>group-icon</div>,
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: () => mockMarketplaceIcon,
}))

describe('agent/tool-icon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuiltInTools = []
    mockCustomTools = []
    mockWorkflowTools = []
    mockMcpTools = []
    mockMarketplaceIcon = undefined
  })

  it('should render a string icon, recover from fetch errors, and keep installed tools warning-free', () => {
    mockBuiltInTools = [{
      name: 'author/tool-a',
      icon: 'https://example.com/tool-a.png',
      is_team_authorization: true,
    }]

    render(<ToolIcon id="tool-1" providerName="author/tool-a" />)

    const icon = screen.getByRole('img', { name: 'tool icon' })
    expect(icon).toHaveAttribute('src', 'https://example.com/tool-a.png')
    expect(screen.queryByText(/indicator:/)).not.toBeInTheDocument()

    fireEvent.mouseEnter(icon)
    expect(screen.queryByText('workflow.nodes.agent.toolNotInstallTooltip')).not.toBeInTheDocument()

    fireEvent.error(icon)
    expect(screen.getByText('group-icon')).toBeInTheDocument()
  })

  it('should render authorization and installation warnings with the correct icon sources', () => {
    mockWorkflowTools = [{
      id: 'author/tool-b',
      icon: {
        content: 'B',
        background: '#fff',
      },
      is_team_authorization: false,
    }]

    const { rerender } = render(<ToolIcon id="tool-2" providerName="author/tool-b" />)

    fireEvent.mouseEnter(screen.getByText('app-icon:#fff:B'))
    expect(screen.getByText('indicator:yellow')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.toolNotAuthorizedTooltip:{"tool":"tool-b"}')).toBeInTheDocument()

    mockWorkflowTools = []
    mockMarketplaceIcon = 'https://example.com/market-tool.png'
    rerender(<ToolIcon id="tool-3" providerName="market/tool-c" />)

    const marketplaceIcon = screen.getByRole('img', { name: 'tool icon' })
    fireEvent.mouseEnter(marketplaceIcon)
    expect(marketplaceIcon).toHaveAttribute('src', 'https://example.com/market-tool.png')
    expect(screen.getByText('indicator:red')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.toolNotInstallTooltip:{"tool":"tool-c"}')).toBeInTheDocument()
  })

  it('should fall back to the group icon while tool data is still loading', () => {
    mockBuiltInTools = undefined

    render(<ToolIcon id="tool-4" providerName="author/tool-d" />)

    expect(screen.getByText('group-icon')).toBeInTheDocument()
    expect(screen.queryByText(/indicator:/)).not.toBeInTheDocument()
  })
})
