/**
 * Centralized mock factories for external services used by workflow.
 *
 * Usage:
 * ```ts
 * vi.mock('@tanstack/react-query', async (importOriginal) =>
 *   (await import('@/test/console/operation-hooks')).mockConsoleOperationHooks(
 *     await importOriginal(),
 *     (await import('../../__tests__/service-mock-factory')).createToolOperationRoutes(),
 *   ),
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

export function createToolOperationRoutes(data?: ToolMockData) {
  return {
    'workspaces.current.tools.builtin.get': () => ({ data: data?.buildInTools ?? [] }),
    'workspaces.current.tools.api.get': () => ({ data: data?.customTools ?? [] }),
    'workspaces.current.tools.workflow.get': () => ({ data: data?.workflowTools ?? [] }),
    'workspaces.current.tools.mcp.get': () => ({ data: data?.mcpTools ?? [] }),
  }
}

export function createTriggerServiceMock(data?: TriggerMockData) {
  return {
    useAllTriggerPlugins: vi.fn(() => ({ data: data?.triggerPlugins ?? [] })),
  }
}
