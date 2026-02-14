import type { AppCardProps } from '../index'
import type { App } from '@/models/explore'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppCard from '../index'

vi.mock('../../../app/type-selector', () => ({
  AppTypeIcon: ({ type }: { type: string }) => <div data-testid="app-type-icon">{type}</div>,
}))

const createApp = (overrides?: Partial<App>): App => ({
  can_trial: true,
  app_id: 'app-id',
  description: 'App description',
  copyright: '2024',
  privacy_policy: null,
  custom_disclaimer: null,
  category: 'Assistant',
  position: 1,
  is_listed: true,
  install_count: 0,
  installed: false,
  editable: true,
  is_agent: false,
  ...overrides,
  app: {
    id: 'id-1',
    mode: AppModeEnum.CHAT,
    icon_type: null,
    icon: '🤖',
    icon_background: '#fff',
    icon_url: '',
    name: 'Sample App',
    description: 'App description',
    use_icon_as_answer_icon: false,
    ...overrides?.app,
  },
})

describe('AppCard', () => {
  const onCreate = vi.fn()
  const onTry = vi.fn()

  const renderComponent = (props?: Partial<AppCardProps>) => {
    const mergedProps: AppCardProps = {
      app: createApp(),
      canCreate: false,
      onCreate,
      onTry,
      isExplore: false,
      ...props,
    }
    return render(<AppCard {...mergedProps} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render app name and description', () => {
      renderComponent()

      expect(screen.getByText('Sample App')).toBeInTheDocument()
      expect(screen.getByText('App description')).toBeInTheDocument()
    })

    it.each([
      [AppModeEnum.CHAT, 'APP.TYPES.CHATBOT'],
      [AppModeEnum.ADVANCED_CHAT, 'APP.TYPES.ADVANCED'],
      [AppModeEnum.AGENT_CHAT, 'APP.TYPES.AGENT'],
      [AppModeEnum.WORKFLOW, 'APP.TYPES.WORKFLOW'],
      [AppModeEnum.COMPLETION, 'APP.TYPES.COMPLETION'],
    ])('should render correct mode label for %s mode', (mode, label) => {
      renderComponent({ app: createApp({ app: { ...createApp().app, mode } }) })

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByTestId('app-type-icon')).toHaveTextContent(mode)
    })

    it('should render description in a truncatable container', () => {
      renderComponent({ app: createApp({ description: 'Very long description text' }) })

      const descWrapper = screen.getByText('Very long description text')
      expect(descWrapper).toHaveClass('line-clamp-4')
    })
  })

  describe('User Interactions', () => {
    it('should show create button in explore mode and trigger action', () => {
      renderComponent({
        app: createApp({ app: { ...createApp().app, mode: AppModeEnum.WORKFLOW } }),
        canCreate: true,
        isExplore: true,
      })

      const button = screen.getByText('explore.appCard.addToWorkspace')
      expect(button).toBeInTheDocument()
      fireEvent.click(button)
      expect(onCreate).toHaveBeenCalledTimes(1)
    })

    it('should render try button in explore mode', () => {
      renderComponent({ canCreate: true, isExplore: true })

      expect(screen.getByText('explore.appCard.try')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should hide action buttons when not in explore mode', () => {
      renderComponent({ canCreate: true, isExplore: false })

      expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
      expect(screen.queryByText('explore.appCard.try')).not.toBeInTheDocument()
    })

    it('should hide create button when canCreate is false', () => {
      renderComponent({ canCreate: false, isExplore: true })

      expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should truncate long app name with title attribute', () => {
      const longName = 'A Very Long Application Name That Should Be Truncated'
      renderComponent({ app: createApp({ app: { ...createApp().app, name: longName } }) })

      const nameElement = screen.getByText(longName)
      expect(nameElement).toHaveAttribute('title', longName)
      expect(nameElement).toHaveClass('truncate')
    })

    it('should render with empty description', () => {
      renderComponent({ app: createApp({ description: '' }) })

      expect(screen.getByText('Sample App')).toBeInTheDocument()
    })

    it('should call onTry when try button is clicked', () => {
      const app = createApp()

      renderComponent({ app, canCreate: true, isExplore: true })

      fireEvent.click(screen.getByText('explore.appCard.try'))

      expect(onTry).toHaveBeenCalledWith({ appId: 'app-id', app })
    })
  })
})
