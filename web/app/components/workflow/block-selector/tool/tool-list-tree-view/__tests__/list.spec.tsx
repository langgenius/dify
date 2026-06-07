import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { createToolProvider } from '../../../__tests__/factories'
import { CUSTOM_GROUP_NAME } from '../../../index-bar'
import List from '../list'

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

describe('ToolListTreeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('translates built-in special group names and renders the nested providers', () => {
    render(
      <List
        payload={{
          BuiltIn: [createToolProvider({
            label: { en_US: 'Built In Provider', zh_Hans: 'Built In Provider' },
          })],
          [CUSTOM_GROUP_NAME]: [createToolProvider({
            id: 'custom-provider',
            type: 'custom',
            label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
          })],
        }}
        previewCardHandle={createPreviewCardHandle()}
        hasSearchText={false}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('BuiltIn')).toBeInTheDocument()
    expect(screen.getByText('workflow.tabs.customTool')).toBeInTheDocument()
    expect(screen.getByText('Built In Provider')).toBeInTheDocument()
    expect(screen.getByText('Custom Provider')).toBeInTheDocument()
  })
})
