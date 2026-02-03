import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useAccountIntegrates } from '@/service/use-common'
import IntegrationsPage from './index'

vi.mock('@/service/use-common', () => ({
  useAccountIntegrates: vi.fn(),
}))

describe('IntegrationsPage', () => {
  it('renders connected integrations', () => {
    vi.mocked(useAccountIntegrates).mockReturnValue({
      data: {
        data: [
          { provider: 'google', is_bound: true, link: '' },
          { provider: 'github', is_bound: true, link: '' },
        ],
      },
    } as unknown as ReturnType<typeof useAccountIntegrates>)

    render(<IntegrationsPage />)

    expect(screen.getByText('common.integrations.connected')).toBeInTheDocument()
    expect(screen.getByText('common.integrations.google')).toBeInTheDocument()
    expect(screen.getByText('common.integrations.github')).toBeInTheDocument()
    // Connect link should not be present when bound
    expect(screen.queryByText('common.integrations.connect')).not.toBeInTheDocument()
  })

  it('renders connect link for unbound integrations', () => {
    vi.mocked(useAccountIntegrates).mockReturnValue({
      data: {
        data: [
          { provider: 'google', is_bound: false, link: 'https://google.com' },
        ],
      },
    } as unknown as ReturnType<typeof useAccountIntegrates>)

    render(<IntegrationsPage />)

    expect(screen.getByText('common.integrations.google')).toBeInTheDocument()
    const connectLink = screen.getByText('common.integrations.connect')
    expect(connectLink).toBeInTheDocument()
    expect(connectLink.closest('a')).toHaveAttribute('href', 'https://google.com')
  })

  it('renders nothing when no integrations are provided', () => {
    vi.mocked(useAccountIntegrates).mockReturnValue({
      data: {
        data: [],
      },
    } as unknown as ReturnType<typeof useAccountIntegrates>)

    render(<IntegrationsPage />)

    expect(screen.getByText('common.integrations.connected')).toBeInTheDocument()
    expect(screen.queryByText('common.integrations.google')).not.toBeInTheDocument()
    expect(screen.queryByText('common.integrations.github')).not.toBeInTheDocument()
  })

  it('handles unknown providers gracefully', () => {
    vi.mocked(useAccountIntegrates).mockReturnValue({
      data: {
        data: [
          { provider: 'unknown', is_bound: false, link: '' },
        ],
      },
    } as unknown as ReturnType<typeof useAccountIntegrates>)

    render(<IntegrationsPage />)

    expect(screen.queryByText('common.integrations.connect')).not.toBeInTheDocument()
  })
})
