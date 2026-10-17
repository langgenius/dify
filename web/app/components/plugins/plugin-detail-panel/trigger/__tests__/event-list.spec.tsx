import type { TriggerEvent } from '@/app/components/plugins/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerEventsList } from '../event-list'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

const mockTriggerEvents = [
  {
    name: 'event-1',
    identity: {
      author: 'author-1',
      name: 'event-1',
      label: { en_US: 'Event One' },
    },
    description: { en_US: 'Event one description' },
    parameters: [],
    output_schema: {},
  },
] as unknown as TriggerEvent[]

let mockDetail: { plugin_id: string; provider: string } | undefined
let mockProviderInfo:
  | { events: TriggerEvent[]; name: string; author: string; icon: string }
  | undefined

vi.mock('../../store', () => ({
  usePluginStore: (selector: (state: { detail: typeof mockDetail }) => typeof mockDetail) =>
    selector({ detail: mockDetail }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: mockProviderInfo }),
}))

describe('TriggerEventsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetail = { plugin_id: 'test-plugin', provider: 'test-provider' }
    mockProviderInfo = {
      events: mockTriggerEvents,
      name: 'Test provider',
      author: 'Dify',
      icon: 'icon.png',
    }
  })

  it.each([undefined, []])('hides the list when provider events are unavailable (%s)', (events) => {
    mockProviderInfo = events ? { ...mockProviderInfo!, events } : undefined
    const { container } = render(<TriggerEventsList />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the selected event from the keyboard and closes its real drawer', async () => {
    const user = userEvent.setup()
    render(<TriggerEventsList />)
    expect(
      screen.getByText(
        'pluginTrigger.events.actionNum:{"num":1,"event":"pluginTrigger.events.event"}',
      ),
    ).toBeInTheDocument()
    const eventButton = screen.getByRole('button', { name: 'Event One' })
    expect(eventButton).toHaveAccessibleDescription('Event one description')
    await user.tab()
    expect(eventButton).toHaveFocus()
    await user.keyboard('{Enter}')
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Event One')).toBeInTheDocument()
    expect(within(drawer).getByText('Test provider')).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('lists multiple events with the plural count', () => {
    const secondEvent = {
      ...mockTriggerEvents[0]!,
      name: 'event-2',
      identity: {
        ...mockTriggerEvents[0]!.identity,
        name: 'event-2',
        label: { en_US: 'Event Two' },
      },
    } as TriggerEvent
    mockProviderInfo = { ...mockProviderInfo!, events: [...mockTriggerEvents, secondEvent] }
    render(<TriggerEventsList />)
    expect(screen.getByRole('button', { name: 'Event One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Event Two' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'pluginTrigger.events.actionNum:{"num":2,"event":"pluginTrigger.events.events"}',
      ),
    ).toBeInTheDocument()
  })
})
