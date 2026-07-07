import type { TriggerWithProvider } from '../../types'
import type { Event } from '@/app/components/tools/types'
import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { Theme } from '@/types/app'
import TriggerPluginActionItem from '../action-item'
import TriggerPluginItem from '../item'
import TriggerPluginList from '../list'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: vi.fn(),
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockUseAllTriggerPlugins = vi.mocked(useAllTriggerPlugins)

const createEvent = (name: string, label: string): Event => ({
  name,
  author: 'Dify',
  label: {
    en_US: label,
    zh_Hans: label,
  },
  description: {
    en_US: `${label} description`,
    zh_Hans: `${label} description`,
  },
  parameters: [{
    name: 'token',
    label: { en_US: 'Token', zh_Hans: 'Token' },
    human_description: { en_US: 'Token', zh_Hans: 'Token' },
    type: 'string',
    form: 'form',
    llm_description: 'Token',
    required: true,
    multiple: false,
    default: '',
  }],
  labels: [],
  output_schema: { type: 'object' },
})

const createTriggerProvider = (overrides: Partial<TriggerWithProvider> = {}): TriggerWithProvider => ({
  id: 'trigger-provider-1',
  name: 'trigger-provider',
  author: 'Trigger Author',
  description: {
    en_US: 'Trigger provider description',
    zh_Hans: 'Trigger provider description',
  },
  icon: '/trigger.svg',
  icon_dark: '/trigger-dark.svg',
  label: {
    en_US: 'Trigger Provider',
    zh_Hans: 'Trigger Provider',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'trigger-plugin-1',
  plugin_unique_identifier: 'trigger-plugin-1@1.0.0',
  events: [createEvent('on_message', 'On Message')],
  meta: { version: '1.0.0' } as TriggerWithProvider['meta'],
  supported_creation_methods: [],
  ...overrides,
})

describe('trigger plugin selector components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseAllTriggerPlugins.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAllTriggerPlugins>)
  })

  it('should select trigger plugin action items with default params and preview details', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const provider = createTriggerProvider()
    const event = createEvent('on_created', 'On Created')

    render(
      <TriggerPluginActionItem
        provider={provider}
        payload={event}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('On Created'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerPlugin, expect.objectContaining({
      plugin_id: 'trigger-plugin-1',
      provider_id: 'trigger-provider',
      event_name: 'on_created',
      event_label: 'On Created',
      params: { token: '' },
    }))
  })

  it('should select trigger plugin action items from the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const provider = createTriggerProvider()
    const event = createEvent('on_created', 'On Created')

    render(
      <TriggerPluginActionItem
        provider={provider}
        payload={event}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    const action = screen.getByRole('button', { name: 'On Created' })
    await user.tab()
    expect(action).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerPlugin, expect.objectContaining({
      event_name: 'on_created',
      event_label: 'On Created',
    }))
  })

  it('should expand providers and select workflow trigger providers directly', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    const { rerender } = render(
      <TriggerPluginItem
        payload={createTriggerProvider({
          events: [
            createEvent('first', 'First Event'),
            createEvent('second', 'Second Event'),
          ],
        })}
        hasSearchText={false}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('Trigger Provider'))

    expect(screen.getByLabelText('workflow.tabs.allTriggers')).toHaveClass('max-h-[240px]', 'overscroll-contain')

    await user.click(screen.getByText('Second Event'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerPlugin, expect.objectContaining({
      event_name: 'second',
      title: 'Second Event',
    }))

    onSelect.mockClear()
    rerender(
      <TriggerPluginItem
        payload={createTriggerProvider({
          type: CollectionType.workflow,
          events: [createEvent('workflow_event', 'Workflow Event')],
        })}
        hasSearchText={false}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('Workflow Event'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerPlugin, expect.objectContaining({
      provider_type: CollectionType.workflow,
      event_name: 'workflow_event',
    }))
  })

  it('should expand trigger providers from the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <TriggerPluginItem
        payload={createTriggerProvider({
          events: [
            createEvent('first', 'First Event'),
            createEvent('second', 'Second Event'),
          ],
        })}
        hasSearchText={false}
        previewCardHandle={createPreviewCardHandle()}
        onSelect={onSelect}
      />,
    )

    const provider = screen.getByRole('button', { name: /Trigger Provider/ })
    await user.tab()
    expect(provider).toHaveFocus()

    await user.keyboard(' ')

    expect(screen.getByRole('region', { name: 'workflow.tabs.allTriggers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Second Event' })).toBeInTheDocument()
  })

  it('should filter trigger plugins and report whether content exists', async () => {
    const onContentStateChange = vi.fn()
    mockUseAllTriggerPlugins.mockReturnValue({
      data: [
        createTriggerProvider(),
        createTriggerProvider({
          id: 'empty-provider',
          name: 'empty-provider',
          label: { en_US: 'Empty Provider', zh_Hans: 'Empty Provider' },
          events: [],
        }),
      ],
    } as ReturnType<typeof useAllTriggerPlugins>)

    const { rerender } = render(
      <TriggerPluginList
        searchText="message"
        onSelect={vi.fn()}
        onContentStateChange={onContentStateChange}
      />,
    )

    expect(screen.getByText('Trigger Provider')).toBeInTheDocument()
    expect(screen.queryByText('Empty Provider')).not.toBeInTheDocument()

    rerender(
      <TriggerPluginList
        searchText="missing"
        onSelect={vi.fn()}
        onContentStateChange={onContentStateChange}
      />,
    )

    await waitFor(() => {
      expect(onContentStateChange).toHaveBeenLastCalledWith(false)
    })
    expect(screen.queryByText('Trigger Provider')).not.toBeInTheDocument()
  })
})
