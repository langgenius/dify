/** External trigger catalog fixture for workflow tests. */
type TriggerMockData = {
  triggerPlugins?: unknown[]
}

export function createTriggerServiceMock(data?: TriggerMockData) {
  return {
    useAllTriggerPlugins: vi.fn(() => ({ data: data?.triggerPlugins ?? [] })),
  }
}
