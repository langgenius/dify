/**
 * Centralized mock factories for external services used by workflow.
 *
 * Usage:
 * ```ts
 * vi.mock('@/service/use-tools', async () =>
 *   (await import('../../__tests__/service-mock-factory')).createToolServiceMock(),
 * )
 * ```
 */

// ---------------------------------------------------------------------------
// SWR service hooks
// ---------------------------------------------------------------------------

type ToolMockData = {
  buildInTools?: unknown[]
  customTools?: unknown[]
  workflowTools?: unknown[]
  mcpTools?: unknown[]
}

type TriggerMockData = {
  triggerPlugins?: unknown[]
}

export function createToolServiceMock(data?: ToolMockData) {
  return {
    useAllBuiltInTools: vi.fn(() => ({ data: data?.buildInTools ?? [] })),
    useAllCustomTools: vi.fn(() => ({ data: data?.customTools ?? [] })),
    useAllWorkflowTools: vi.fn(() => ({ data: data?.workflowTools ?? [] })),
    useAllMCPTools: vi.fn(() => ({ data: data?.mcpTools ?? [] })),
  }
}

export function createTriggerServiceMock(data?: TriggerMockData) {
  return {
    useAllTriggerPlugins: vi.fn(() => ({ data: data?.triggerPlugins ?? [] })),
  }
}
