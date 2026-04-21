import { render, screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import Tools from '../tools'
import { ViewType } from '../view-type-select'
import { createToolProvider } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
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
    render(
      <Tools
        tools={[]}
        onSelect={vi.fn()}
        viewType={ViewType.flat}
        hasSearchText={false}
      />,
    )

    expect(screen.getByText('No tools available')).toBeInTheDocument()
  })

  it('renders tree groups for built-in and custom providers', () => {
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
  })

  it('shows the alphabetical index in flat view when enough tools are present', () => {
    const { container } = render(
      <Tools
        tools={Array.from({ length: 11 }, (_, index) =>
          createToolProvider({
            id: `provider-${index}`,
            label: {
              en_US: `${String.fromCharCode(65 + index)} Provider`,
              zh_Hans: `${String.fromCharCode(65 + index)} Provider`,
            },
          }))}
        onSelect={vi.fn()}
        viewType={ViewType.flat}
        hasSearchText={false}
      />,
    )

    expect(container.querySelector('.index-bar')).toBeInTheDocument()
    expect(screen.getByText('A Provider')).toBeInTheDocument()
    expect(screen.getByText('K Provider')).toBeInTheDocument()
  })
})
