import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../../types'
import { createTool, createToolProvider } from '../../__tests__/factories'
import ToolActionItem from '../action-item'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockTrackEvent = vi.mocked(trackEvent)

describe('ToolActionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  it('should select tools with default params and track the selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <ToolActionItem
        provider={createToolProvider()}
        payload={createTool('search', 'Search Tool')}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Search Tool' }))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.Tool, expect.objectContaining({
      provider_id: 'provider-1',
      tool_name: 'search',
      tool_label: 'Search Tool',
      params: {},
    }))
    expect(mockTrackEvent).toHaveBeenCalledWith('tool_selected', {
      tool_name: 'search',
      plugin_id: 'plugin-1',
    })
  })

  it('should not select disabled tools and should show added state', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <ToolActionItem
        provider={createToolProvider()}
        payload={createTool('search', 'Search Tool')}
        previewCardHandle={createPreviewCardHandle()}
        disabled
        isAdded
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('tools.addToolModal.added')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search Tool/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Search Tool/ }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})
