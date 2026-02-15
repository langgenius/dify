import type { ModalContextState } from '@/context/modal-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { downloadUrl } from '@/utils/download'
import Toast from '../../base/toast'
import Compliance from './compliance'

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContext: vi.fn(),
  }
})

vi.mock('@/service/common', () => ({
  getDocDownloadUrl: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

describe('Compliance', () => {
  const mockSetShowPricingModal = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
    })
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)
  })

  const renderWithQueryClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>,
    )
  }

  // Wrapper for tests that need the menu open
  const openMenuAndRender = () => {
    renderWithQueryClient(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
  }

  it('renders compliance menu trigger', () => {
    renderWithQueryClient(<Compliance />)
    expect(screen.getByText('common.userProfile.compliance')).toBeDefined()
  })

  it('shows SOC2, ISO, GDPR items when opened', () => {
    openMenuAndRender()
    expect(screen.getByText('common.compliance.soc2Type1')).toBeDefined()
    expect(screen.getByText('common.compliance.soc2Type2')).toBeDefined()
    expect(screen.getByText('common.compliance.iso27001')).toBeDefined()
    expect(screen.getByText('common.compliance.gdpr')).toBeDefined()
  })

  it('shows Upgrade badge for sandbox plan on restricted docs', () => {
    openMenuAndRender()
    // SOC2 Type I is restricted for sandbox
    expect(screen.getAllByText('billing.upgradeBtn.encourageShort').length).toBeGreaterThan(0)
  })

  it('shows Download button for plan that allows it', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })
    openMenuAndRender()
    expect(screen.getAllByText('common.operation.download').length).toBeGreaterThan(0)
  })

  it('triggers download mutation successfully', async () => {
    const mockUrl = 'http://example.com/doc.pdf'
    vi.mocked(getDocDownloadUrl).mockResolvedValue({ url: mockUrl })
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })

    openMenuAndRender()
    const downloadButtons = screen.getAllByText('common.operation.download')
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(getDocDownloadUrl).toHaveBeenCalled()
      expect(downloadUrl).toHaveBeenCalledWith({ url: mockUrl })
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        message: 'common.operation.downloadSuccess',
      }))
    })
  })

  it('handles download mutation error', async () => {
    vi.mocked(getDocDownloadUrl).mockRejectedValue(new Error('Download failed'))
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

    openMenuAndRender()
    const downloadButtons = screen.getAllByText('common.operation.download')
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(getDocDownloadUrl).toHaveBeenCalled()
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'common.operation.downloadFailed',
      }))
    })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('handles upgrade click on badge for sandbox plan', () => {
    openMenuAndRender()
    const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
    fireEvent.click(upgradeBadges[0])
    expect(mockSetShowPricingModal).toHaveBeenCalled()
  })

  it('handles upgrade click on badge for non-sandbox plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
    })

    openMenuAndRender()
    // SOC2 Type II is restricted for professional
    const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
    fireEvent.click(upgradeBadges[0])
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.BILLING,
    })
  })
})
