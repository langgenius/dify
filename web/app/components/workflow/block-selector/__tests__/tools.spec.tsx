import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import Tools from '../tools'
import { ViewType } from '../types'
import { createTool, createToolProvider } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
  useDocLink: () => (path?: string) => `https://docs.example.com${path || ''}`,
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)

describe('Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('shows the empty state when there are no tools and no search text', () => {
    const { rerender } = render(
      <Tools tools={[]} onSelect={vi.fn()} viewType={ViewType.flat} hasSearchText={false} />,
    )

    expect(screen.getByText('No tools available')).toBeInTheDocument()
    rerender(<Tools tools={[]} onSelect={vi.fn()} viewType={ViewType.flat} hasSearchText />)
    expect(screen.queryByText('No tools available')).not.toBeInTheDocument()
  })

  it('groups providers by author and tool category', () => {
    render(
      <Tools
        tools={[
          createToolProvider({
            id: 'built-in-provider',
            author: 'Built In',
            label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
          }),
          createToolProvider({
            id: 'custom-provider',
            type: CollectionType.custom,
            label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
          }),
          createToolProvider({
            id: 'mcp-provider',
            type: 'mcp',
            label: { en_US: 'MCP Provider', zh_Hans: 'MCP Provider' },
          }),
          createToolProvider({
            id: 'workflow-provider',
            type: CollectionType.workflow,
            tools: [createTool('workflow-tool', 'Run Workflow')],

            label: { en_US: 'Workflow Provider', zh_Hans: 'Workflow Provider' },
          }),
        ]}
        onSelect={vi.fn()}
        viewType={ViewType.tree}
        hasSearchText={false}
      />,
    )

    expect(screen.getByText('Built In')).toBeInTheDocument()
    expect(screen.getByText('workflow.tabs.customTool')).toBeInTheDocument()
    expect(screen.getByText('Built In Provider')).toBeInTheDocument()
    expect(screen.getByText('Custom Provider')).toBeInTheDocument()
    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByText('MCP Provider')).toBeInTheDocument()
    expect(screen.getByText('workflow.tabs.workflowTool')).toBeInTheDocument()
    expect(screen.getByText('Run Workflow')).toBeInTheDocument()
  })

  it('connects the alphabetical index to the matching provider group', async () => {
    const user = userEvent.setup()
    const targets: string[] = []
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement,
    ) {
      targets.push(this.textContent || '')
    })
    render(
      <Tools
        tools={Array.from({ length: 11 }, (_, index) =>
          createToolProvider({
            id: `provider-${index}`,
            label: {
              en_US: `${String.fromCharCode(65 + index)} Provider`,
              zh_Hans: `${String.fromCharCode(65 + index)} Provider`,
            },
          }),
        )}
        onSelect={vi.fn()}
        viewType={ViewType.flat}
        hasSearchText={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'K' })).toBeInTheDocument()
    expect(screen.getByText('A Provider')).toBeInTheDocument()
    expect(screen.getByText('K Provider')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'K' }))
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth' })
    expect(targets).toEqual([expect.stringContaining('K Provider')])
    scroll.mockRestore()
  })
})
