import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { createToolProvider } from '../../../__tests__/factories'
import Item from '../item'

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

describe('ToolListTreeView Item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('renders the group heading and its provider list', () => {
    render(
      <Item
        groupName="My Group"
        toolList={[createToolProvider({
          label: { en_US: 'Provider Alpha', zh_Hans: 'Provider Alpha' },
        })]}
        previewCardHandle={createPreviewCardHandle()}
        hasSearchText={false}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('My Group')).toBeInTheDocument()
    expect(screen.getByText('Provider Alpha')).toBeInTheDocument()
  })
})
