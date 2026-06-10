import type { App, AppSSO } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppInfoTrigger from '../app-info-trigger'

vi.mock('../../../base/app-icon', () => ({
  default: ({ size, icon, background }: {
    size: string
    icon: string
    background: string
    iconType?: string
    imageUrl?: string
  }) => (
    <div data-testid="app-icon" data-size={size} data-icon={icon} data-bg={background} />
  ),
}))

const createAppDetail = (overrides: Partial<App> = {}): App & Partial<AppSSO> => ({
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: '',
  description: 'A test app',
  use_icon_as_answer_icon: false,
  ...overrides,
} as App & Partial<AppSSO>)

describe('AppInfoTrigger', () => {
  it('should render app icon with correct size when expanded', () => {
    render(<AppInfoTrigger appDetail={createAppDetail()} expand onClick={vi.fn()} />)
    const icon = screen.getByTestId('app-icon')
    expect(icon).toHaveAttribute('data-size', 'large')
  })

  it('should render app icon with small size when collapsed', () => {
    render(<AppInfoTrigger appDetail={createAppDetail()} expand={false} onClick={vi.fn()} />)
    const icon = screen.getByTestId('app-icon')
    expect(icon).toHaveAttribute('data-size', 'small')
  })

  it('should show app name when expanded', () => {
    render(<AppInfoTrigger appDetail={createAppDetail({ name: 'My Chatbot' })} expand onClick={vi.fn()} />)
    expect(screen.getByText('My Chatbot')).toBeInTheDocument()
  })

  it('should not show app name when collapsed', () => {
    render(<AppInfoTrigger appDetail={createAppDetail({ name: 'My Chatbot' })} expand={false} onClick={vi.fn()} />)
    expect(screen.queryByText('My Chatbot')).not.toBeInTheDocument()
  })

  it('should show app mode label when expanded', () => {
    render(<AppInfoTrigger appDetail={createAppDetail({ mode: AppModeEnum.ADVANCED_CHAT })} expand onClick={vi.fn()} />)
    expect(screen.getByText('app.types.advanced')).toBeInTheDocument()
  })

  it('should not show mode label when collapsed', () => {
    render(<AppInfoTrigger appDetail={createAppDetail()} expand={false} onClick={vi.fn()} />)
    expect(screen.queryByText('app.types.chatbot')).not.toBeInTheDocument()
  })

  it('should call onClick when button is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<AppInfoTrigger appDetail={createAppDetail()} expand onClick={onClick} />)

    await user.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should show settings icon in expanded and collapsed states', () => {
    const { container, rerender } = render(
      <AppInfoTrigger appDetail={createAppDetail()} expand onClick={vi.fn()} />,
    )
    expect(container.querySelector('svg')).toBeInTheDocument()

    rerender(<AppInfoTrigger appDetail={createAppDetail()} expand={false} onClick={vi.fn()} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should apply ml-1 class to icon wrapper when collapsed', () => {
    render(
      <AppInfoTrigger appDetail={createAppDetail()} expand={false} onClick={vi.fn()} />,
    )
    const iconWrapper = screen.getByTestId('app-icon').parentElement
    expect(iconWrapper).toHaveClass('ml-1')
  })

  it('should not apply ml-1 class when expanded', () => {
    render(<AppInfoTrigger appDetail={createAppDetail()} expand onClick={vi.fn()} />)
    const iconWrapper = screen.getByTestId('app-icon').parentElement
    expect(iconWrapper).not.toHaveClass('ml-1')
  })
})
