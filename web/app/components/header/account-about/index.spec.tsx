import type { LangGeniusVersionResponse } from '@/models/common'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import AccountAbout from './index'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: string }) => options?.version ? `${key} ${options.version}` : key,
  }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('@/app/components/header/plan-badge', () => ({
  default: ({ plan }: { plan: string }) => <div data-testid="plan-badge">{plan}</div>,
}))

vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, onClose }: { children: React.ReactNode, onClose: () => void }) => (
    <div data-testid="modal">
      <button onClick={onClose} data-testid="modal-close">Close</button>
      {children}
    </div>
  ),
}))

type GlobalPublicStore = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

describe('AccountAbout', () => {
  const mockVersionInfo = {
    current_version: '0.6.0',
    latest_version: '0.6.0',
    release_notes: 'https://github.com/langgenius/dify/releases/tag/0.6.0',
    version: '0.6.0',
    release_date: '2024-01-01',
    can_auto_update: false,
    current_env: 'production',
  }

  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: false } },
    } as unknown as GlobalPublicStore))
  })

  it('renders correctly with version information', () => {
    render(<AccountAbout langGeniusVersionInfo={mockVersionInfo as unknown as LangGeniusVersionResponse} onCancel={mockOnCancel} />)
    expect(screen.getByText(/Version/i)).toBeDefined()
    expect(screen.getAllByText(/0.6.0/).length).toBeGreaterThan(0)
  })

  it('shows "Latest Available" when current version equals latest', () => {
    render(<AccountAbout langGeniusVersionInfo={mockVersionInfo as unknown as LangGeniusVersionResponse} onCancel={mockOnCancel} />)
    expect(screen.getByText(/about.latestAvailable/)).toBeDefined()
  })

  it('shows "Now Available" when current version is behind', () => {
    const behindVersionInfo = { ...mockVersionInfo, latest_version: '0.7.0' }
    render(<AccountAbout langGeniusVersionInfo={behindVersionInfo as unknown as LangGeniusVersionResponse} onCancel={mockOnCancel} />)
    expect(screen.getByText(/about.nowAvailable/)).toBeDefined()
    expect(screen.getByText(/about.updateNow/)).toBeDefined()
  })

  it('calls onCancel when close button is clicked', () => {
    render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('renders branding logo if enabled', () => {
    vi.mocked(useGlobalPublicStore).mockReturnValue({
      branding: { enabled: true, workspace_logo: 'custom-logo.png' },
    } as unknown as SystemFeatures)
    render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)
    const img = screen.getByAltText('logo')
    expect(img).toBeDefined()
    expect(img.getAttribute('src')).toBe('custom-logo.png')
  })
})
