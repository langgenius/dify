import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { createToolProvider } from '../../../__tests__/factories'
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

describe('ToolListFlatView', () => {
  beforeEach(() => {
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('targets the first provider of each letter for index navigation', () => {
    const toolRefs = {
      current: {} as Record<string, HTMLDivElement | null>,
    }

    render(
      <List
        letters={['A', 'B']}
        previewCardHandle={createPreviewCardHandle()}
        payload={[
          createToolProvider({
            id: 'provider-a',
            label: { en_US: 'A Provider', zh_Hans: 'A Provider' },
            letter: 'A',
          } as ReturnType<typeof createToolProvider>),
          createToolProvider({
            id: 'provider-a-second',
            label: { en_US: 'Another A Provider', zh_Hans: 'Another A Provider' },
            letter: 'A',
          } as ReturnType<typeof createToolProvider>),
          createToolProvider({
            id: 'provider-b',
            label: { en_US: 'B Provider', zh_Hans: 'B Provider' },
            letter: 'B',
          } as ReturnType<typeof createToolProvider>),
        ]}
        isShowLetterIndex
        indexBar={<div data-testid="index-bar" />}
        hasSearchText={false}
        onSelect={vi.fn()}
        toolRefs={toolRefs}
      />,
    )

    expect(screen.getByText('A Provider')).toBeInTheDocument()
    expect(screen.getByText('B Provider')).toBeInTheDocument()
    expect(screen.getByTestId('index-bar')).toBeInTheDocument()
    expect(toolRefs.current.A).toContainElement(screen.getByText('A Provider'))
    expect(toolRefs.current.A).not.toContainElement(screen.getByText('Another A Provider'))
    expect(toolRefs.current.B).toContainElement(screen.getByText('B Provider'))
  })
})
