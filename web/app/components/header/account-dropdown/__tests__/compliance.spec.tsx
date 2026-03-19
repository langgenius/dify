import type { ModalContextState } from '@/context/modal-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/app/components/base/ui/dropdown-menu'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { downloadUrl } from '@/utils/download'
import Toast from '../../../base/toast'
import Compliance from '../compliance'

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

describe('Compliance', () => {
  const mockSetShowPricingModal = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
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

    vi.spyOn(Toast, 'notify').mockImplementation(() => ({}))
  })

  const renderWithQueryClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>,
    )
  }

  const renderCompliance = () => {
    return renderWithQueryClient(
      <DropdownMenu open={true} onOpenChange={() => {}}>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <Compliance />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }

  const openMenuAndRender = () => {
    renderCompliance()
    fireEvent.click(screen.getByText('common.userProfile.compliance'))
  }

  describe('Rendering', () => {
    it('should render compliance menu trigger', () => {
      // Act
      renderCompliance()

      // Assert
      expect(screen.getByText('common.userProfile.compliance')).toBeInTheDocument()
    })

    it('should show SOC2, ISO, GDPR items when opened', () => {
      // Act
      openMenuAndRender()

      // Assert
      expect(screen.getByText('common.compliance.soc2Type1')).toBeInTheDocument()
      expect(screen.getByText('common.compliance.soc2Type2')).toBeInTheDocument()
      expect(screen.getByText('common.compliance.iso27001')).toBeInTheDocument()
      expect(screen.getByText('common.compliance.gdpr')).toBeInTheDocument()
    })
  })

  describe('Plan-based Content', () => {
    it('should show Upgrade badge for sandbox plan on restricted docs', () => {
      // Act
      openMenuAndRender()

      // Assert
      // SOC2 Type I is restricted for sandbox
      expect(screen.getAllByText('billing.upgradeBtn.encourageShort').length).toBeGreaterThan(0)
    })

    it('should show Download button for plan that allows it', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
        },
      })

      // Act
      openMenuAndRender()

      // Assert
      expect(screen.getAllByText('common.operation.download').length).toBeGreaterThan(0)
    })
  })

  describe('Actions', () => {
    it('should trigger download mutation successfully', async () => {
      // Arrange
      const mockUrl = 'http://example.com/doc.pdf'
      vi.mocked(getDocDownloadUrl).mockResolvedValue({ url: mockUrl })
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
        },
      })

      // Act
      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')
      fireEvent.click(downloadButtons[0])

      // Assert
      await waitFor(() => {
        expect(getDocDownloadUrl).toHaveBeenCalled()
        expect(downloadUrl).toHaveBeenCalledWith({ url: mockUrl })
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
          message: 'common.operation.downloadSuccess',
        }))
      })
    })

    it('should handle download mutation error', async () => {
      // Arrange
      vi.mocked(getDocDownloadUrl).mockRejectedValue(new Error('Download failed'))
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
        },
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

      // Act
      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')
      fireEvent.click(downloadButtons[0])

      // Assert
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

    it('should handle upgrade click on badge for sandbox plan', () => {
      // Act
      openMenuAndRender()
      const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
      fireEvent.click(upgradeBadges[0])

      // Assert
      expect(mockSetShowPricingModal).toHaveBeenCalled()
    })

    it('should handle upgrade click on badge for non-sandbox plan', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.professional,
        },
      })

      // Act
      openMenuAndRender()
      // SOC2 Type II is restricted for professional
      const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
      fireEvent.click(upgradeBadges[0])

      // Assert
      expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
        payload: ACCOUNT_SETTING_TAB.BILLING,
      })
    })

    // isPending branches: spinner visible, disabled class, guard blocks second call
    it('should show spinner and guard against duplicate download when isPending is true', async () => {
      // Arrange
      let resolveDownload: (value: { url: string }) => void
      vi.mocked(getDocDownloadUrl).mockImplementation(() => new Promise((resolve) => {
        resolveDownload = resolve
      }))
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
        },
      })

      // Act
      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')
      fireEvent.click(downloadButtons[0])

      // Assert - btn-disabled class and spinner should appear while mutation is pending
      await waitFor(() => {
        const menuItem = screen.getByText('common.compliance.soc2Type1').closest('[role="menuitem"]')
        expect(menuItem).not.toBeNull()
        const disabledBtn = menuItem!.querySelector('.cursor-not-allowed')
        expect(disabledBtn).not.toBeNull()
      }, { timeout: 10000 })

      // Cleanup: resolve the pending promise
      resolveDownload!({ url: 'http://example.com/doc.pdf' })
      await waitFor(() => {
        expect(downloadUrl).toHaveBeenCalled()
      })
    })

    it('should not call downloadCompliance again while pending', async () => {
      let resolveDownload: (value: { url: string }) => void
      vi.mocked(getDocDownloadUrl).mockImplementation(() => new Promise((resolve) => {
        resolveDownload = resolve
      }))
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.team,
        },
      })

      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')

      // First click starts download
      fireEvent.click(downloadButtons[0])

      // Wait for mutation to start and React to re-render (isPending=true)
      await waitFor(() => {
        const menuItem = screen.getByText('common.compliance.soc2Type1').closest('[role="menuitem"]')
        const el = menuItem!.querySelector('.cursor-not-allowed')
        expect(el).not.toBeNull()
        expect(getDocDownloadUrl).toHaveBeenCalledTimes(1)
      }, { timeout: 10000 })

      // Second click while pending - should be guarded by isPending check
      fireEvent.click(downloadButtons[0])

      resolveDownload!({ url: 'http://example.com/doc.pdf' })
      await waitFor(() => {
        expect(downloadUrl).toHaveBeenCalledTimes(1)
      }, { timeout: 10000 })
      // getDocDownloadUrl should still have only been called once
      expect(getDocDownloadUrl).toHaveBeenCalledTimes(1)
    }, 20000)

    // canShowUpgradeTooltip=false: enterprise plan has empty tooltip text → no TooltipContent
    it('should show upgrade badge with empty tooltip for enterprise plan', () => {
      // Arrange
      vi.mocked(useProviderContext).mockReturnValue({
        ...baseProviderContextValue,
        plan: {
          ...baseProviderContextValue.plan,
          type: Plan.enterprise,
        },
      })

      // Act
      openMenuAndRender()

      // Assert - enterprise is not in any download list, so upgrade badges should appear
      // The key branch: upgradeTooltip[Plan.enterprise] = '' → canShowUpgradeTooltip=false
      expect(screen.getAllByText('billing.upgradeBtn.encourageShort').length).toBeGreaterThan(0)
    })
  })
})
