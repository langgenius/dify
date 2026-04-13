import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../../types'
import { createTool, createToolProvider } from '../../__tests__/factories'
import { ViewType } from '../../view-type-select'
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

  it('expands a provider and selects an action item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Tool
        payload={createToolProvider({
          tools: [
            createTool('tool-a', 'Tool A'),
            createTool('tool-b', 'Tool B'),
          ],
        })}
        viewType={ViewType.flat}
        hasSearchText={false}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('Provider One'))
    await user.click(screen.getByText('Tool B'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.Tool, expect.objectContaining({
      provider_id: 'provider-1',
      provider_name: 'provider-one',
      tool_name: 'tool-b',
      title: 'Tool B',
    }))
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
        viewType={ViewType.flat}
        hasSearchText={false}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('Workflow Tool'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.Tool, expect.objectContaining({
      provider_type: CollectionType.workflow,
      tool_name: 'workflow-tool',
      tool_label: 'Workflow Tool',
    }))
  })
})
