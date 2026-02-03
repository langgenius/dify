import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import MaintenanceNotice from './maintenance-notice'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: vi.fn(),
}))

// Mock NOTICE_I18N to control href for testing link rendering
vi.mock('@/i18n-config/language', async () => {
  const actual = await vi.importActual<typeof import('@/i18n-config/language')>('@/i18n-config/language')
  return {
    ...actual,
    NOTICE_I18N: {
      ...actual.NOTICE_I18N,
      title: { en_US: 'Important Notice', zh_Hans: 'zh_important_notice' },
      desc: { en_US: 'Maintenance content', zh_Hans: 'zh_maintenance_content' },
      href: '#',
    },
  }
})

describe('MaintenanceNotice', () => {
  beforeEach(() => {
    vi.mocked(useLanguage).mockReturnValue('en_US')
    localStorage.clear()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('renders correctly when not hidden', () => {
    render(<MaintenanceNotice />)
    expect(screen.getByText('Important Notice')).toBeDefined()
    expect(screen.getByText('Maintenance content')).toBeDefined()
  })

  it('renders the correct language', () => {
    vi.mocked(useLanguage).mockReturnValue('zh_Hans')
    render(<MaintenanceNotice />)
    expect(screen.getByText('zh_important_notice')).toBeDefined()
    expect(screen.getByText('zh_maintenance_content')).toBeDefined()
  })

  it('does not render when hidden in localStorage', () => {
    localStorage.setItem('hide-maintenance-notice', '1')
    render(<MaintenanceNotice />)
    expect(screen.queryByText('Important Notice')).toBeNull()
  })

  it('hides when close button is clicked and sets localStorage', () => {
    const { container } = render(<MaintenanceNotice />)
    const closeButton = container.querySelector('.cursor-pointer.text-gray-500')
    expect(closeButton).not.toBeNull()

    fireEvent.click(closeButton!)

    expect(screen.queryByText('Important Notice')).toBeNull()
    expect(localStorage.getItem('hide-maintenance-notice')).toBe('1')
  })

  it('handles jump notice when href is provided', async () => {
    // Re-mock to provide a real href
    const { NOTICE_I18N } = await import('@/i18n-config/language')
    NOTICE_I18N.href = 'https://example.com'

    render(<MaintenanceNotice />)
    const desc = screen.getByText('Maintenance content')
    fireEvent.click(desc)

    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')

    // Reset for other tests
    NOTICE_I18N.href = '#'
  })
})
