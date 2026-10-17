import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render as renderWithoutPricing, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { seedFeatures } from '@/test/console/query-data'
import { downloadUrl } from '@/utils/download'
import Compliance from '../compliance'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

const mockDownloadCompliance = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'compliance.download.get': mockDownloadCompliance,
    }),
  }
})
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
    mockDownloadCompliance.mockReset()
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

  const openMenuAndRender = async () => {
    renderCompliance()
    await userEvent
      .setup()
      .click(screen.getByRole('menuitem', { name: 'common.userProfile.compliance' }))
    await screen.findByRole('menuitem', { name: /common.compliance.gdpr/ })
  }

  const getComplianceMenuItem = (label: string) => {
    return screen.getByRole('menuitem', { name: new RegExp(label) })
  }

  it('keeps GDPR downloadable while plan-dependent documents wait for features', async () => {
    queryClient.clear()
    vi.mocked(consoleClient.compliance.download.get).mockResolvedValue({
      url: 'https://example.com/gdpr.pdf',
    })
    await openMenuAndRender()
    expect(screen.queryByText('common.compliance.soc2Type1')).not.toBeInTheDocument()
    expect(screen.queryByText('common.compliance.soc2Type2')).not.toBeInTheDocument()
    expect(screen.queryByText('common.compliance.iso27001')).not.toBeInTheDocument()
    expect(getComplianceMenuItem('common.compliance.gdpr')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByText('common.compliance.gdpr'))
    await waitFor(() =>
      expect(consoleClient.compliance.download.get).toHaveBeenCalledWith(
        { query: { doc_name: 'GDPR' } },
        { context: { silent: true } },
      ),
    )
    expect(onPricingUrlUpdate).not.toHaveBeenCalled()
  })

  describe('Actions', () => {
    it('should trigger download mutation successfully', async () => {
      const mockUrl = 'http://example.com/doc.pdf'
      vi.mocked(consoleClient.compliance.download.get).mockResolvedValue({ url: mockUrl })
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      await openMenuAndRender()
      await userEvent.setup().click(getComplianceMenuItem('common.compliance.soc2Type1'))

      await waitFor(() => {
        expect(consoleClient.compliance.download.get).toHaveBeenCalledWith(
          { query: { doc_name: 'SOC2_Type_I' } },
          { context: { silent: true } },
        )
        expect(downloadUrl).toHaveBeenCalledWith({ url: mockUrl })
        expect(toastSuccessSpy).toHaveBeenCalledWith('common.operation.downloadSuccess')
      })
    })

    it('should handle download mutation error', async () => {
      vi.mocked(consoleClient.compliance.download.get).mockRejectedValue(
        new Error('Download failed'),
      )
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await openMenuAndRender()
      await userEvent.setup().click(getComplianceMenuItem('common.compliance.soc2Type1'))

      await waitFor(() => {
        expect(consoleClient.compliance.download.get).toHaveBeenCalledWith(
          { query: { doc_name: 'SOC2_Type_I' } },
          { context: { silent: true } },
        )
        expect(toastErrorSpy).toHaveBeenCalledWith('common.operation.downloadFailed')
      })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should handle upgrade click on badge for sandbox plan', async () => {
      await openMenuAndRender()
      await userEvent.setup().click(getComplianceMenuItem('common.compliance.soc2Type2'))

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should handle upgrade click on badge for non-sandbox plan', async () => {
      seedFeatures(queryClient, { billing: { subscription: { plan: 'professional' } } })

      await openMenuAndRender()
      // SOC2 Type II is restricted for professional
      await userEvent.setup().click(getComplianceMenuItem('common.compliance.soc2Type2'))

      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('billing'),
      )
    })

    // isPending branches: spinner visible and the owning menu item blocks a second call

    it('should not call downloadCompliance again while pending', async () => {
      let resolveDownload: (value: { url: string }) => void
      vi.mocked(consoleClient.compliance.download.get).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDownload = resolve
          }),
      )
      seedFeatures(queryClient, { billing: { subscription: { plan: 'team' } } })

      await openMenuAndRender()
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
