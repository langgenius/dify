import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render as renderWithoutPricing, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { seedFeatures } from '@/test/console/query-data'
import { downloadUrl } from '@/utils/download'
import Compliance from '../compliance'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    compliance: {
      download: {
        get: vi.fn(),
      },
    },
  },
}))
vi.mock('@/service/base', () => ({
  request: vi.fn(() => new Promise(() => {})),
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('Compliance', () => {
  const toastSuccessSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')
  const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    toastSuccessSpy.mockClear()
    toastErrorSpy.mockClear()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    seedFeatures(queryClient, { billing: { subscription: { plan: 'sandbox' } } })
  })

  const renderWithQueryClient = (ui: React.ReactElement) => {
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
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

  const getComplianceMenuItem = (label: string) => {
    return screen.getByText(label).closest('[role="menuitem"]')
  }

  it('keeps GDPR downloadable while plan-dependent documents wait for features', async () => {
    queryClient.clear()
    vi.mocked(consoleClient.compliance.download.get).mockResolvedValue({
      url: 'https://example.com/gdpr.pdf',
    })
    openMenuAndRender()
    expect(screen.queryByText('common.compliance.soc2Type1')).not.toBeInTheDocument()
    expect(screen.queryByText('common.compliance.soc2Type2')).not.toBeInTheDocument()
    expect(screen.queryByText('common.compliance.iso27001')).not.toBeInTheDocument()
    expect(getComplianceMenuItem('common.compliance.gdpr')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('common.compliance.gdpr'))
    await waitFor(() =>
      expect(consoleClient.compliance.download.get).toHaveBeenCalledWith(
        { query: { doc_name: 'GDPR' } },
        { context: { silent: true } },
      ),
    )
    expect(onPricingUrlUpdate).not.toHaveBeenCalled()
  })

  describe('Rendering', () => {
    it('should render compliance menu trigger', () => {
      // Act
      renderCompliance()

      // Assert
      // Assert
      expect(screen.getByText('common.userProfile.compliance'))!.toBeInTheDocument()
    })

    it('should show SOC2, ISO, GDPR items when opened', () => {
      // Act
      openMenuAndRender()

      // Assert
      // Assert
      expect(screen.getByText('common.compliance.soc2Type1'))!.toBeInTheDocument()
      expect(screen.getByText('common.compliance.soc2Type2'))!.toBeInTheDocument()
      expect(screen.getByText('common.compliance.iso27001'))!.toBeInTheDocument()
      expect(screen.getByText('common.compliance.gdpr'))!.toBeInTheDocument()
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
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      // Act
      openMenuAndRender()

      // Assert
      expect(screen.getAllByText('common.operation.download').length).toBeGreaterThan(0)
      expect(getComplianceMenuItem('common.compliance.soc2Type1')).toHaveAccessibleName(
        'common.compliance.soc2Type1 common.operation.download',
      )
    })
  })

  describe('Actions', () => {
    it('should trigger download mutation successfully', async () => {
      // Arrange
      const mockUrl = 'http://example.com/doc.pdf'
      vi.mocked(consoleClient.compliance.download.get).mockResolvedValue({ url: mockUrl })
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      // Act
      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')
      fireEvent.click(downloadButtons[0]!)

      // Assert
      await waitFor(() => {
        expect(consoleClient.compliance.download.get).toHaveBeenCalled()
        expect(downloadUrl).toHaveBeenCalledWith({ url: mockUrl })
        expect(toastSuccessSpy).toHaveBeenCalledWith('common.operation.downloadSuccess')
      })
    })

    it('should handle download mutation error', async () => {
      // Arrange
      vi.mocked(consoleClient.compliance.download.get).mockRejectedValue(
        new Error('Download failed'),
      )
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      openMenuAndRender()
      const downloadButtons = screen.getAllByText('common.operation.download')
      fireEvent.click(downloadButtons[0]!)

      // Assert
      await waitFor(() => {
        expect(consoleClient.compliance.download.get).toHaveBeenCalled()
        expect(toastErrorSpy).toHaveBeenCalledWith('common.operation.downloadFailed')
      })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should handle upgrade click on badge for sandbox plan', async () => {
      // Act
      openMenuAndRender()
      const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
      fireEvent.click(upgradeBadges[0]!)

      // Assert
      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should handle upgrade click on badge for non-sandbox plan', async () => {
      // Arrange
      seedFeatures(queryClient, { billing: { subscription: { plan: 'professional' } } })

      // Act
      openMenuAndRender()
      // SOC2 Type II is restricted for professional
      const upgradeBadges = screen.getAllByText('billing.upgradeBtn.encourageShort')
      fireEvent.click(upgradeBadges[0]!)

      // Assert
      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('billing'),
      )
    })

    // isPending branches: spinner visible and the owning menu item blocks a second call
    it('should show spinner and guard against duplicate download when isPending is true', async () => {
      // Arrange
      let resolveDownload: (value: { url: string }) => void
      vi.mocked(consoleClient.compliance.download.get).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDownload = resolve
          }),
      )
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      // Act
      openMenuAndRender()
      const menuItem = getComplianceMenuItem('common.compliance.soc2Type1')
      expect(menuItem).not.toBeNull()
      fireEvent.click(menuItem!)

      // Assert - the menu item owns the pending interaction state
      await waitFor(
        () => {
          expect(menuItem).toHaveAttribute('aria-disabled', 'true')
          expect(menuItem!.querySelector('.animate-spin')).not.toBeNull()
        },
        { timeout: 10000 },
      )

      // Cleanup: resolve the pending promise
      resolveDownload!({ url: 'http://example.com/doc.pdf' })
      await waitFor(() => {
        expect(downloadUrl).toHaveBeenCalled()
      })
    })

    it('should not call downloadCompliance again while pending', async () => {
      let resolveDownload: (value: { url: string }) => void
      vi.mocked(consoleClient.compliance.download.get).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDownload = resolve
          }),
      )
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      openMenuAndRender()
      const menuItem = getComplianceMenuItem('common.compliance.soc2Type1')
      expect(menuItem).not.toBeNull()

      // First click starts download
      fireEvent.click(menuItem!)

      // Wait for mutation to start and React to re-render (isPending=true)
      await waitFor(
        () => {
          expect(menuItem).toHaveAttribute('aria-disabled', 'true')
          expect(consoleClient.compliance.download.get).toHaveBeenCalledTimes(1)
        },
        { timeout: 10000 },
      )

      // Second click while pending - should be guarded by isPending check
      fireEvent.click(menuItem!)

      resolveDownload!({ url: 'http://example.com/doc.pdf' })
      await waitFor(
        () => {
          expect(downloadUrl).toHaveBeenCalledTimes(1)
        },
        { timeout: 10000 },
      )
      // getDocDownloadUrl should still have only been called once
      expect(consoleClient.compliance.download.get).toHaveBeenCalledTimes(1)
    }, 20000)
  })
})
