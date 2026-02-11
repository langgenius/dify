import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ViewFormDropdown from './view-form-dropdown'

// -------------------- Mocks --------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal-root" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, state }: { children: React.ReactNode, state: string }) => (
    <button data-testid="mock-action-button" data-state={state}>{children}</button>
  ),
  ActionButtonState: {
    Default: 'default',
    Hover: 'hover',
  },
}))

vi.mock('./content', () => ({
  default: () => <div data-testid="mock-inputs-form-content" />,
}))

describe('ViewFormDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the dropdown trigger with initial state', () => {
    render(<ViewFormDropdown />)

    const trigger = screen.getByTestId('portal-trigger')
    expect(trigger).toBeInTheDocument()

    const actionButton = screen.getByTestId('mock-action-button')
    expect(actionButton).toHaveAttribute('data-state', 'default')
  })

  it('toggles open state when trigger is clicked', () => {
    render(<ViewFormDropdown />)

    const trigger = screen.getByTestId('portal-trigger')
    const portalRoot = screen.getByTestId('portal-root')

    // initial closed state
    expect(portalRoot).toHaveAttribute('data-open', 'false')

    // open
    fireEvent.click(trigger)
    expect(portalRoot).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('mock-action-button')).toHaveAttribute('data-state', 'hover')

    // close
    fireEvent.click(trigger)
    expect(portalRoot).toHaveAttribute('data-open', 'false')
  })

  it('renders content when opened', () => {
    render(<ViewFormDropdown />)

    const trigger = screen.getByTestId('portal-trigger')
    fireEvent.click(trigger)

    expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    expect(screen.getByText('chat.chatSettingsTitle')).toBeInTheDocument()
    expect(screen.getByTestId('mock-inputs-form-content')).toBeInTheDocument()
  })
})
