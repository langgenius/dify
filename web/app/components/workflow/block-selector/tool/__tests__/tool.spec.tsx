import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../../types'
import { createTool, createToolProvider } from '../../__tests__/factories'
import { ViewType } from '../../types'
import Tool from '../tool'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockTrackEvent = vi.mocked(trackEvent)

describe('Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('keeps provider disclosures independently expanded', async () => {
    const user = userEvent.setup()

    render(
      <>
        <Tool
          payload={createToolProvider()}
          previewCardHandle={createPreviewCardHandle()}
          viewType={ViewType.flat}
          hasSearchText={false}
          onSelect={vi.fn()}
        />
        <Tool
          payload={createToolProvider({
            id: 'provider-2',
            name: 'provider-two',
            label: { en_US: 'Provider Two', zh_Hans: 'Provider Two' },
            tools: [createTool('tool-b', 'Tool B')],
          })}
          previewCardHandle={createPreviewCardHandle()}
          viewType={ViewType.flat}
          hasSearchText={false}
          onSelect={vi.fn()}
        />
      </>,
    )

    const firstDisclosure = screen.getByRole('button', { name: /Provider One/ })
    const secondDisclosure = screen.getByRole('button', { name: /Provider Two/ })

    expect(firstDisclosure).toHaveAttribute('aria-expanded', 'false')
    expect(firstDisclosure).toHaveAttribute('aria-controls')
    expect(secondDisclosure).toHaveAttribute('aria-expanded', 'false')

    await user.click(firstDisclosure)
    await user.click(secondDisclosure)

    expect(firstDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(secondDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Tool A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tool B' })).toBeInTheDocument()
  })

  it('orders the provider, add-all, and action buttons without collapsing on add-all', async () => {
    const user = userEvent.setup()
    const onSelectMultiple = vi.fn()

    render(
      <Tool
        payload={createToolProvider({
          tools: [createTool('tool-a', 'Tool A'), createTool('tool-b', 'Tool B')],
        })}
        previewCardHandle={createPreviewCardHandle()}
        viewType={ViewType.flat}
        hasSearchText={false}
        onSelect={vi.fn()}
        onSelectMultiple={onSelectMultiple}
      />,
    )

    const disclosure = screen.getByRole('button', { name: /Provider One/ })
    disclosure.focus()
    await user.keyboard('{Enter}')

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    await user.tab()
    const addAllButton = screen.getByRole('button', { name: 'workflow.tabs.addAll' })
    expect(addAllButton).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(onSelectMultiple).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.arrayContaining([
        expect.objectContaining({ tool_name: 'tool-a' }),
        expect.objectContaining({ tool_name: 'tool-b' }),
      ]),
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Tool A' })).toHaveFocus()
  })

  it('selects an expanded action item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Tool
        payload={createToolProvider({
          tools: [createTool('tool-a', 'Tool A'), createTool('tool-b', 'Tool B')],
        })}
        previewCardHandle={createPreviewCardHandle()}
        viewType={ViewType.flat}
        hasSearchText={false}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Provider One/ }))
    await user.click(screen.getByRole('button', { name: 'Tool B' }))

    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({
        provider_id: 'provider-1',
        provider_name: 'provider-one',
        tool_name: 'tool-b',
        title: 'Tool B',
      }),
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('tool_selected', {
      tool_name: 'tool-b',
      plugin_id: 'plugin-1',
    })
  })

  it('selects workflow tools directly without expanding the provider', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Tool
        payload={createToolProvider({
          type: CollectionType.workflow,
          tools: [createTool('workflow-tool', 'Workflow Tool')],
        })}
        previewCardHandle={createPreviewCardHandle()}
        viewType={ViewType.flat}
        hasSearchText={false}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('Workflow Tool'))

    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({
        provider_type: CollectionType.workflow,
        tool_name: 'workflow-tool',
        tool_label: 'Workflow Tool',
      }),
    )
  })
})
