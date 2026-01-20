import type { TriggerEvent } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerEventsList } from './event-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.num !== undefined)
        return `${options.num} ${options.event || 'events'}`
      return key
    },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
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

let mockDetail: { plugin_id: string, provider: string } | undefined
let mockProviderInfo: { events: TriggerEvent[] } | undefined

vi.mock('../store', () => ({
  usePluginStore: (selector: (state: { detail: typeof mockDetail }) => typeof mockDetail) =>
    selector({ detail: mockDetail }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: mockProviderInfo }),
}))

vi.mock('./event-detail-drawer', () => ({
  EventDetailDrawer: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="event-detail-drawer">
      <button data-testid="close-drawer" onClick={onClose}>Close</button>
    </div>
  ),
}))

describe('TriggerEventsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetail = { plugin_id: 'test-plugin', provider: 'test-provider' }
    mockProviderInfo = { events: mockTriggerEvents }
  })

  describe('Rendering', () => {
    it('should render event count', () => {
      render(<TriggerEventsList />)

      expect(screen.getByText('1 events.event')).toBeInTheDocument()
    })

    it('should render event cards', () => {
      render(<TriggerEventsList />)

      expect(screen.getByText('Event One')).toBeInTheDocument()
      expect(screen.getByText('Event one description')).toBeInTheDocument()
    })

    it('should return null when no provider info', () => {
      mockProviderInfo = undefined
      const { container } = render(<TriggerEventsList />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should return null when no events', () => {
      mockProviderInfo = { events: [] }
      const { container } = render(<TriggerEventsList />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should return null when no detail', () => {
      mockDetail = undefined
      mockProviderInfo = undefined
      const { container } = render(<TriggerEventsList />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('User Interactions', () => {
    it('should show detail drawer when event card clicked', () => {
      render(<TriggerEventsList />)

      fireEvent.click(screen.getByText('Event One'))

      expect(screen.getByTestId('event-detail-drawer')).toBeInTheDocument()
    })

    it('should hide detail drawer when close clicked', () => {
      render(<TriggerEventsList />)

      fireEvent.click(screen.getByText('Event One'))
      expect(screen.getByTestId('event-detail-drawer')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('close-drawer'))
      expect(screen.queryByTestId('event-detail-drawer')).not.toBeInTheDocument()
    })
  })

  describe('Multiple Events', () => {
    it('should render multiple event cards', () => {
      const secondEvent = {
        name: 'event-2',
        identity: {
          author: 'author-2',
          name: 'event-2',
          label: { en_US: 'Event Two' },
        },
        description: { en_US: 'Event two description' },
        parameters: [],
        output_schema: {},
      } as unknown as TriggerEvent

      mockProviderInfo = {
        events: [...mockTriggerEvents, secondEvent],
      }
      render(<TriggerEventsList />)

      expect(screen.getByText('Event One')).toBeInTheDocument()
      expect(screen.getByText('Event Two')).toBeInTheDocument()
      expect(screen.getByText('2 events.events')).toBeInTheDocument()
    })
  })
})
