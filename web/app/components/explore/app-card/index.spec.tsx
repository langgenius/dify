import type { AppCardProps } from './index'
import type { App } from '@/models/explore'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppCard from './index'

vi.mock('../../app/type-selector', () => ({
  AppTypeIcon: ({ type }: any) => <div data-testid="app-type-icon">{type}</div>,
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

  const renderComponent = (props?: Partial<AppCardProps>) => {
    const mergedProps: AppCardProps = {
      app: createApp(),
      canCreate: false,
      onCreate,
      isExplore: false,
      ...props,
    }
    return render(<AppCard {...mergedProps} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render app info with correct mode label when mode is CHAT', () => {
    renderComponent({ app: createApp({ app: { ...createApp().app, mode: AppModeEnum.CHAT } }) })

    expect(screen.getByText('Sample App')).toBeInTheDocument()
    expect(screen.getByText('App description')).toBeInTheDocument()
    expect(screen.getByText('APP.TYPES.CHATBOT')).toBeInTheDocument()
    expect(screen.getByTestId('app-type-icon')).toHaveTextContent(AppModeEnum.CHAT)
  })

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
    expect(screen.getByText('APP.TYPES.WORKFLOW')).toBeInTheDocument()
  })

  it('should hide create button when not allowed', () => {
    renderComponent({ canCreate: false, isExplore: true })

    expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
  })
})
