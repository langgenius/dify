import type { AppContextValue } from '@/context/app-context'
import type { ProviderContextState } from '@/context/provider-context'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import Support from './support'

const { mockZendeskKey } = vi.hoisted(() => ({
  mockZendeskKey: { value: 'test-key' },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/config', () => ({
  get ZENDESK_WIDGET_KEY() { return mockZendeskKey.value },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/zendesk/utils', () => ({
  toggleZendeskWindow: vi.fn(),
}))

vi.mock('../utils/util', () => ({
  mailToSupport: vi.fn(() => 'mailto:support@dify.ai'),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}))

describe('Support', () => {
  const mockCloseAccountDropdown = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockZendeskKey.value = 'test-key'
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { email: 'test@example.com' },
      langGeniusVersionInfo: { current_version: '0.6.0' },
    } as unknown as AppContextValue)
    vi.mocked(useProviderContext).mockReturnValue({
      plan: { type: Plan.professional },
    } as unknown as ProviderContextState)
  })

  it('renders support menu trigger', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    expect(screen.getByText('userProfile.support')).toBeDefined()
  })

  it('shows forum and community links when opened', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('userProfile.forum')).toBeDefined()
    expect(screen.getByText('userProfile.community')).toBeDefined()
  })

  it('shows "Contact Us" when ZENDESK_WIDGET_KEY is present', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('userProfile.contactUs')).toBeDefined()
  })

  it('hides dedicated support channels for Sandbox plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      plan: { type: Plan.sandbox },
    } as unknown as ProviderContextState)
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('userProfile.contactUs')).toBeNull()
    expect(screen.queryByText('userProfile.emailSupport')).toBeNull()
  })

  it('calls toggleZendeskWindow and closeAccountDropdown when "Contact Us" is clicked', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('userProfile.contactUs'))
    expect(toggleZendeskWindow).toHaveBeenCalledWith(true)
    expect(mockCloseAccountDropdown).toHaveBeenCalled()
  })

  it('shows "Email Support" when ZENDESK_WIDGET_KEY is absent', () => {
    mockZendeskKey.value = ''
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('userProfile.emailSupport')).toBeDefined()
    expect(screen.queryByText('userProfile.contactUs')).toBeNull()
  })

  it('has correct forum and community links', () => {
    render(<Support closeAccountDropdown={mockCloseAccountDropdown} />)
    fireEvent.click(screen.getByRole('button'))
    const forumLink = screen.getByText('userProfile.forum').closest('a')
    const communityLink = screen.getByText('userProfile.community').closest('a')
    expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
    expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  })
})
