import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithoutPricing,
} from '@/test/console/query-data'
import WorkflowLogArchivesPage from '../index'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
  }
})

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContext: vi.fn(),
  }
})

const archiveMonth: GetWorkflowRunArchivesResponse['months'][number] = {
  year: 2025,
  month: 3,
  workflow_run_count: 125,
  row_count: 1125,
  archive_bytes: 1048576,
  bundle_count: 2,
  latest_archived_at: '2025-03-03T00:00:00Z',
  download_task: null,
}

const archiveData: GetWorkflowRunArchivesResponse = {
  summary: {
    archived_month_count: 1,
    workflow_run_count: 125,
    archive_bytes: 1048576,
    latest_archived_at: '2025-03-03T00:00:00Z',
  },
  months: [archiveMonth],
}

let plan: CloudPlan = 'professional'

function renderPage(
  data: GetWorkflowRunArchivesResponse | null = archiveData,
  queryClient = createConsoleQueryClient(),
) {
  if (data) queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), data)

  return render(<WorkflowLogArchivesPage />, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { billing: { subscription: { plan } } },
  })
}

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('WorkflowLogArchivesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    plan = 'professional'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Archive table states', () => {
    it('should hide loading rows from assistive technology until archives arrive', async () => {
      const queryClient = createConsoleQueryClient()
      let resolveArchives!: (data: GetWorkflowRunArchivesResponse) => void
      const response = new Promise<GetWorkflowRunArchivesResponse>((resolve) => {
        resolveArchives = resolve
      })
      const request = queryClient.query({
        queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
        queryFn: () => response,
      })

      renderPage(null, queryClient)

      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(1)
      expect(within(table).getAllByRole('row', { hidden: true }).length).toBeGreaterThan(1)
      expect(within(table).queryByText('appLog.archives.empty.title')).not.toBeInTheDocument()

      await act(async () => {
        resolveArchives(archiveData)
        await request
      })

      expect(await within(table).findByRole('row', { name: /2025-03/ })).toBeInTheDocument()
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(2)
    })

    it('should present an archive request error in a cell spanning the table columns', async () => {
      const queryClient = createConsoleQueryClient()
      const queryKey = consoleQuery.workflowRunArchives.get.queryKey()
      queryClient.setQueryDefaults(queryKey, { retryOnMount: false })
      await queryClient
        .query({
          queryKey,
          queryFn: () => Promise.reject(new Error('Archives unavailable')),
        })
        .catch(() => undefined)

      renderPage(null, queryClient)

      const table = screen.getByRole('table')
      const errorCell = within(table).getByRole('cell', { name: /appLog\.archives\.error\.title/ })
      expect(errorCell).toHaveAttribute('colspan', '4')
      expect(within(errorCell).getByText('appLog.archives.error.description')).toBeInTheDocument()
      expect(within(table).queryByText('appLog.archives.empty.title')).not.toBeInTheDocument()
      expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    })

    it('should present an empty archive message in a cell spanning the table columns', () => {
      renderPage({
        months: [],
        summary: {
          archived_month_count: 0,
          workflow_run_count: 0,
          archive_bytes: 0,
          latest_archived_at: null,
        },
      })

      const table = screen.getByRole('table')
      const emptyCell = within(table).getByRole('cell', { name: /appLog\.archives\.empty\.title/ })
      expect(emptyCell).toHaveAttribute('colspan', '4')
      expect(within(emptyCell).getByText('appLog.archives.empty.description')).toBeInTheDocument()
      expect(within(table).queryByText('appLog.archives.error.title')).not.toBeInTheDocument()
      expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    })

    it('should reveal remaining archive months when the load-more region enters view', () => {
      let intersect: (isIntersecting: boolean) => void = () => {}
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            intersect = (isIntersecting) =>
              callback(
                [{ isIntersecting } as IntersectionObserverEntry],
                this as unknown as IntersectionObserver,
              )
          }

          observe() {}
          disconnect() {}
        },
      )
      const months = Array.from({ length: 21 }, (_, index) => ({
        ...archiveMonth,
        year: 2025 + Math.floor(index / 12),
        month: (index % 12) + 1,
      }))
      renderPage({
        months,
        summary: {
          ...archiveData.summary,
          archived_month_count: months.length,
          workflow_run_count: months.length * 125,
          archive_bytes: months.length * 1048576,
        },
      })

      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(21)
      expect(within(table).queryByRole('row', { name: /2026-09/ })).not.toBeInTheDocument()

      act(() => intersect(false))
      expect(within(table).queryByRole('row', { name: /2026-09/ })).not.toBeInTheDocument()

      act(() => intersect(true))
      expect(within(table).getByRole('row', { name: /2026-09/ })).toBeInTheDocument()
      expect(within(table).getAllByRole('row')).toHaveLength(22)
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(22)
    })
  })

  describe('Plan access', () => {
    it('should show upgrade guidance instead of archive content for sandbox workspaces', () => {
      // Arrange
      plan = 'sandbox'

      // Act
      renderPage()

      // Assert
      expect(screen.getByText('appLog.archives.upgradeTip.title')).toBeInTheDocument()
      expect(screen.queryByText('2025-03')).not.toBeInTheDocument()
    })

    it('should open pricing modal from the sandbox upgrade guidance', async () => {
      // Arrange
      plan = 'sandbox'
      renderPage()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

      // Assert
      await waitFor(() =>
        expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
      )
    })

    it('should show archive content for paid workspaces', () => {
      // Arrange
      plan = 'professional'

      // Act
      renderPage()

      // Assert
      expect(screen.queryByText('appLog.archives.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getByText('2025-03')).toBeInTheDocument()
      const table = screen.getByRole('table')
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual([
        'appLog.archives.table.month',
        'appLog.archives.table.runs',
        'appLog.archives.table.size',
        'appLog.archives.table.action',
      ])
      const row = within(table).getByRole('row', { name: /2025-03/ })
      expect(within(row).getByRole('cell', { name: '125' })).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'appLog.archives.action.prepareDownload 2025-03',
        }),
      ).toBeInTheDocument()
    })
  })
})
