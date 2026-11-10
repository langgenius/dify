import type { PendingActionDisclosure } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderRuntime } from '@/features/dify-builder/state'
import { vi } from 'vite-plus/test'

type RuntimeOverrides = Omit<Partial<DifyBuilderRuntime>, 'session'> & {
  session?: Partial<DifyBuilderRuntime['session']>
}

export const createDifyBuilderRuntime = (overrides: RuntimeOverrides = {}): DifyBuilderRuntime => ({
  appId: 'app-1',
  canEdit: true,
  enabled: true,
  getCanvasSnapshot: () => ({ nodes: [], edges: [], isChatflow: false }),
  setShowPanel: vi.fn(),
  retryCanvasRefresh: vi.fn(),
  ...overrides,
  session: {
    onCanvasRefreshed: vi.fn(),
    getTrace: vi.fn(() => ({ entries: [], truncated: false })),
    loadOlderConversation: vi.fn(async () => true),
    refresh: vi.fn(async () => true),
    restore: vi.fn(async () => true),
    stopTask: vi.fn(async () => true),
    resumeTask: vi.fn(async () => true),
    reset: vi.fn(),
    clearConversation: vi.fn(async () => true),
    abandonTask: vi.fn(async () => true),
    runAction: vi.fn(async () => true),
    sendMessage: vi.fn(async () => true),
    startBuild: vi.fn(async () => true),
    startChecklistFix: vi.fn(async () => true),
    startEdit: vi.fn(async () => true),
    startFix: vi.fn(async () => true),
    updateModel: vi.fn(async () => true),
    ...overrides.session,
  },
})

export const createNativeApproval = (
  overrides: Partial<PendingActionDisclosure> = {},
): PendingActionDisclosure => ({
  pending_operation_id: 'operation-1',
  wait_reason: 'approval',
  version: 1,
  scope_digest: 'a'.repeat(64),
  account_label: 'Test account',
  action: 'Read one message',
  target: { message: 'Synthetic message' },
  parameters_summary: { limit: 1 },
  risk_notice: 'The operation reads one test message.',
  required_configuration: [],
  native_form_ref: null,
  approval_limits: {
    max_calls: 1,
    max_dispatches: 1,
    max_cost_units: 0,
    expires_at: '2099-11-10T00:00:00Z',
  },
  decision_status: 'awaiting_decision',
  ...overrides,
})
