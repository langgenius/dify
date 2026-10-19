import type { DifyBuilderRuntime } from '@/app/components/workflow-app/components/dify-builder/store'
import { vi } from 'vite-plus/test'

type RuntimeOverrides = Omit<Partial<DifyBuilderRuntime>, 'session'> & {
  session?: Partial<DifyBuilderRuntime['session']>
}

export const createDifyBuilderRuntime = (overrides: RuntimeOverrides = {}): DifyBuilderRuntime => ({
  appId: 'app-1',
  canEdit: true,
  enabled: true,
  getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
  setShowPanel: vi.fn(),
  ...overrides,
  session: {
    onCanvasRefreshed: vi.fn(),
    getTrace: vi.fn(() => ({ entries: [], truncated: false })),
    loadOlderConversation: vi.fn(async () => true),
    refresh: vi.fn(async () => true),
    restore: vi.fn(async () => true),
    reset: vi.fn(),
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
