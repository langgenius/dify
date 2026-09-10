import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

const archiveData: GetWorkflowRunArchivesResponse = {
  summary: {
    archived_month_count: 1,
    workflow_run_count: 125,
    archive_bytes: 1048576,
    latest_archived_at: '2025-03-03T00:00:00Z',
  },
  months: [
    {
      year: 2025,
      month: 3,
      workflow_run_count: 125,
      row_count: 1125,
      archive_bytes: 1048576,
      bundle_count: 2,
      latest_archived_at: '2025-03-03T00:00:00Z',
      download_task: null,
    },
  ],
}

let plan: CloudPlan = 'professional'

function renderPage() {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), archiveData)

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
      expect(screen.getAllByText('125').length).toBeGreaterThan(0)
      expect(
        screen.getByRole('button', {
          name: 'appLog.archives.action.prepareDownload 2025-03',
        }),
      ).toBeInTheDocument()
    })
  })
})
