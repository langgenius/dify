import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { BlockEnum } from '../../../types'
import { createTool, createToolProvider } from '../../__tests__/factories'
import ToolActionItem from '../action-item'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const mockTrackEvent = vi.mocked(trackEvent)

describe('ToolActionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const toolButton = screen.getByRole('button', { name: 'Search Tool' })
    expect(toolButton).toHaveAccessibleDescription('Search Tool description')

    await user.click(toolButton)

    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({
        provider_id: 'provider-1',
        tool_name: 'search',
        tool_label: 'Search Tool',
        params: {},
      }),
    )
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
