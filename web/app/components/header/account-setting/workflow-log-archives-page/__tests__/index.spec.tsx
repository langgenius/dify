import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { createTestQueryClient, renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import WorkflowLogArchivesPage from '../index'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

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

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseModalContext = vi.mocked(useModalContext)

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

function mockPlan(planType: Plan.sandbox | Plan.professional) {
  mockUseProviderContext.mockReturnValue(createMockProviderContextValue({
    enableBilling: true,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  }))
}

function renderPage() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(consoleQuery.workflowRunArchives.get.queryKey(), archiveData)

  return renderWithSystemFeatures(<WorkflowLogArchivesPage />, {
    queryClient,
  })
}

describe('WorkflowLogArchivesPage', () => {
  const setShowPricingModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockPlan(Plan.professional)
    mockUseModalContext.mockReturnValue({
      setShowPricingModal,
    } as unknown as ReturnType<typeof useModalContext>)
  })

  describe('Plan access', () => {
    it('should show upgrade guidance instead of archive content for sandbox workspaces', () => {
      // Arrange
      mockPlan(Plan.sandbox)

      // Act
      renderPage()

      // Assert
      expect(screen.getByText('appLog.archives.upgradeTip.title')).toBeInTheDocument()
      expect(screen.queryByText('2025-03')).not.toBeInTheDocument()
    })

    it('should open pricing modal from the sandbox upgrade guidance', () => {
      // Arrange
      mockPlan(Plan.sandbox)
      renderPage()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' }))

      // Assert
      expect(setShowPricingModal).toHaveBeenCalledTimes(1)
    })

    it('should show archive content for paid workspaces', () => {
      // Arrange
      mockPlan(Plan.professional)

      // Act
      renderPage()

      // Assert
      expect(screen.queryByText('appLog.archives.upgradeTip.title')).not.toBeInTheDocument()
      expect(screen.getByText('2025-03')).toBeInTheDocument()
      expect(screen.getAllByText('125').length).toBeGreaterThan(0)
    })
  })
})
