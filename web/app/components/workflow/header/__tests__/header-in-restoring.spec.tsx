import type { VersionHistory } from '@/types/workflow'
import { screen } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowVersion } from '../../types'
import HeaderInRestoring from '../header-in-restoring'

const mockRestoreWorkflow = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockRequestRestore = vi.fn()

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
  useLeaderRestore: () => ({
    requestRestore: mockRequestRestore,
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

  it('should enable restore when version and flow config are both ready', () => {
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
})
