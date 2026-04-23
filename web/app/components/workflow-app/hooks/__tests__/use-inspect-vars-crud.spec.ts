import { renderHook } from '@testing-library/react'
import { useInspectVarsCrud } from '../use-inspect-vars-crud'

const mockUseInspectVarsCrudCommon = vi.fn()
const mockUseConfigsMap = vi.fn()

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: (...args: unknown[]) => mockUseInspectVarsCrudCommon(...args),
}))

vi.mock('@/app/components/workflow-app/hooks/use-configs-map', () => ({
  useConfigsMap: () => mockUseConfigsMap(),
}))

describe('useInspectVarsCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfigsMap.mockReturnValue({
      flowId: 'app-1',
      flowType: 'app-flow',
      fileSettings: { enabled: true },
    })
    mockUseInspectVarsCrudCommon.mockReturnValue({
      fetchInspectVarValue: vi.fn(),
      editInspectVarValue: vi.fn(),
      deleteInspectVar: vi.fn(),
    })
  })

  it('should call the shared inspect vars hook with workflow-app configs and return its api', () => {
    const { result } = renderHook(() => useInspectVarsCrud())

    expect(mockUseInspectVarsCrudCommon).toHaveBeenCalledWith({
      flowId: 'app-1',
      flowType: 'app-flow',
      fileSettings: { enabled: true },
    })
    expect(result.current).toEqual({
      fetchInspectVarValue: expect.any(Function),
      editInspectVarValue: expect.any(Function),
      deleteInspectVar: expect.any(Function),
    })
  })
})
