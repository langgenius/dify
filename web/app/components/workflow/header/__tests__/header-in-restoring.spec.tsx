import type { VersionHistory } from '@/types/workflow'
import { fireEvent, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { FlowType } from '@/types/common'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowVersion } from '../../types'
import HeaderInRestoring from '../header-in-restoring'

const mockRestoreWorkflow = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
let mockPlanType = Plan.professional
let mockEnableBilling = true
const mockAppContextState = vi.hoisted(() => ({
  userProfile: {
    id: '',
    name: '',
  },
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: mockPlanType },
    enableBilling: mockEnableBilling,
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn(() => '09:30:00'),
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: vi.fn(() => '3 hours ago'),
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
  useRestoreWorkflow: () => ({
    mutateAsync: mockRestoreWorkflow,
  }),
}))

vi.mock('../../hooks', () => ({
  useWorkflowRun: () => ({
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
}))

const createVersion = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
  },
  created_at: 1_700_000_000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  hash: 'hash-1',
  updated_at: 1_700_000_100,
  updated_by: {
    id: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
  },
  tool_published: false,
  version: 'v1',
  marked_name: 'Release 1',
  marked_comment: '',
  ...overrides,
})

describe('HeaderInRestoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlanType = Plan.professional
    mockEnableBilling = true
  })

  it('should disable restore when the flow id is not ready yet', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion(),
      },
      hooksStoreProps: {
        configsMap: undefined,
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeDisabled()
  })

  it('should enable restore when version and flow id are both ready', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion(),
      },
      hooksStoreProps: {
        configsMap: {
          flowId: 'app-1',
          flowType: undefined as never,
          fileSettings: {} as never,
        },
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeEnabled()
  })

  it('should keep restore disabled for draft versions even when flow config is ready', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion({
          version: WorkflowVersion.Draft,
        }),
      },
      hooksStoreProps: {
        configsMap: {
          flowId: 'app-1',
          flowType: FlowType.appFlow,
          fileSettings: {} as never,
        },
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeDisabled()
  })

  it('should show plan upgrade modal instead of restoring when sandbox users click restore', () => {
    mockPlanType = Plan.sandbox
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion(),
      },
      hooksStoreProps: {
        configsMap: {
          flowId: 'app-1',
          flowType: FlowType.appFlow,
          fileSettings: {} as never,
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

    expect(screen.getByText('billing.upgrade.workflowRestore.title')).toBeInTheDocument()
    expect(mockRestoreWorkflow).not.toHaveBeenCalled()
    expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
  })
})
